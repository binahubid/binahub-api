import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { loadOutboundContext, OutboundBlockedError, outboundTemplateHash, processOutboundQueue, recipientBlocker, renderInitialOutreach, type OutboundProspect } from "@/lib/outbound-email";
import { recordRuntimeError } from "@/lib/runtime-observability";

export const runtime = "nodejs";
export const maxDuration = 120;
const schema = z.object({
  action: z.enum(["test", "send", "process"]), campaignId: z.string().uuid(),
  locale: z.enum(["id", "en"]).default("id"), requestKey: z.string().uuid(),
  prospectIds: z.array(z.string().uuid()).max(50).default([]),
  confirmation: z.enum(["SEND_TEST_TO_MY_EMAIL", "SEND_SELECTED_RECIPIENTS", "PROCESS_APPROVED_QUEUE"]),
}).strict();
const querySchema = z.object({ campaignId: z.string().uuid(), locale: z.enum(["id", "en"]).default("id") });

function startQueue(jobId?: string) {
  after(async () => {
    try { await processOutboundQueue(jobId); }
    catch (error) { await recordRuntimeError({ code: "OUTBOUND_EMAIL_WORKER_FAILED", message: error instanceof Error ? error.message : String(error), route: "/api/admin/acquisition/email" }); }
  });
}

async function campaignTargets(db: ReturnType<typeof createServerSupabase>, campaignId: string) {
  const [prospects, batches, deliveries] = await Promise.all([
    db.from("acquisition_prospects").select("*").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(500),
    db.from("prospect_import_batches").select("id,status,approved_by,approved_at,created_at").eq("campaign_id", campaignId),
    db.from("outbound_email_deliveries").select("id,job_id,prospect_id,email,kind,status,error_message,provider_email_id,created_at").eq("campaign_id", campaignId).order("created_at", { ascending: false }).limit(500),
  ]);
  if (deliveries.error && ["42P01", "PGRST205"].includes(deliveries.error.code)) throw new Error("Pengiriman email belum tersedia. Jalankan SQL 60 sebelum menggunakan fitur ini.");
  if (prospects.error || batches.error || deliveries.error) throw new Error(prospects.error?.message || batches.error?.message || deliveries.error?.message || "Data target belum tersedia.");
  const emails = (prospects.data || []).map((row) => row.email);
  const suppressions = emails.length ? await db.from("email_suppressions").select("email").in("email", emails) : { data: [], error: null };
  if (suppressions.error) throw new Error("Daftar jangan dihubungi belum dapat diperiksa.");
  return { prospects: (prospects.data || []) as OutboundProspect[], batches: batches.data || [], deliveries: deliveries.data || [], suppressed: new Set<string>((suppressions.data || []).map((row) => row.email)) };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const query = querySchema.safeParse({ campaignId: req.nextUrl.searchParams.get("campaignId"), locale: req.nextUrl.searchParams.get("locale") || "id" });
  if (!query.success) return adminError("Pilih kampanye terlebih dahulu.", 400, "INVALID_OUTBOUND_CAMPAIGN");
  try {
    const db = createServerSupabase();
    const [context, targets] = await Promise.all([loadOutboundContext(db, query.data.campaignId, query.data.locale), campaignTargets(db, query.data.campaignId)]);
    const { template } = context;
    const preview = template ? renderInitialOutreach(template, { name: "Bapak/Ibu", company: "Perusahaan Anda" }, `https://binahub.id${query.data.locale === "en" ? "/en/insight" : "/insight"}`) : null;
    const testResult = template ? await db.from("outbound_email_jobs").select("id,outbound_email_deliveries(status,email)").eq("campaign_id", query.data.campaignId).eq("kind", "test").eq("requested_by", admin.email).eq("template_hash", outboundTemplateHash(template)).eq("locale", query.data.locale).gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()).limit(100) : { data: [], error: null };
    if (testResult.error) throw new Error(testResult.error.message);
    const testSent = (testResult.data || []).some((job) => job.outbound_email_deliveries.some((row: { status: string; email: string }) => row.status === "sent" && row.email === admin.email));
    const batchMap = new Map(targets.batches.map((batch) => [batch.id, batch]));
    const deliveryMap = new Map(targets.deliveries.filter((row) => row.kind === "initial").map((row) => [row.email, row]));
    const prospects = targets.prospects.map((prospect) => {
      const prior = deliveryMap.get(prospect.email);
      const blockedReason = prior ? "Email pertama sudah masuk antrean atau pernah diproses" : context.source ? recipientBlocker(prospect, context.source, query.data.campaignId, batchMap.get(prospect.batch_id), context.audience, targets.suppressed) : "Sumber data belum tersedia";
      return { ...prospect, blockedReason, deliveryStatus: prior?.status || null };
    });
    return NextResponse.json({ success: true, ready: context.ready, blockers: context.blockers, myEmail: admin.email, mode: context.control.effectiveMode, preview, templateVersion: template?.version || null, testSent, prospects, deliveries: targets.deliveries }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error instanceof Error ? error.message : "Kampanye email belum dapat dimuat.", 503, "OUTBOUND_EMAIL_LOAD_FAILED"); }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, schema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_OUTBOUND_EMAIL");
  const input = parsed.data;
  const expected = { test: "SEND_TEST_TO_MY_EMAIL", send: "SEND_SELECTED_RECIPIENTS", process: "PROCESS_APPROVED_QUEUE" };
  if (input.confirmation !== expected[input.action]) return adminError("Konfirmasi pengiriman tidak sesuai.", 400, "OUTBOUND_CONFIRMATION_REQUIRED");
  try {
    const db = createServerSupabase();
    const context = await loadOutboundContext(db, input.campaignId, input.locale);
    if (!context.ready || !context.template) throw new OutboundBlockedError(context.blockers.join(" "));
    if (input.action === "process") {
      // Only jobs for this campaign; never process unrelated recipients from an admin action.
      after(async () => { try { await processOutboundQueue(undefined, input.campaignId); } catch (error) { await recordRuntimeError({ code: "OUTBOUND_EMAIL_WORKER_FAILED", message: String(error), route: "/api/admin/acquisition/email" }); } });
      return NextResponse.json({ success: true, message: "Antrean diproses. Tidak ada penerima baru yang ditambahkan." }, { status: 202 });
    }
    const template = context.template;
    renderInitialOutreach(template, { name: "Bapak/Ibu", company: "Perusahaan Anda" }, "https://binahub.id/insight");
    let recipients: Array<{ prospectId: string | null; name: string; email: string; company: string | null }>;
    if (input.action === "test") {
      if (!context.audience.has(admin.email)) throw new OutboundBlockedError("Email admin Anda belum masuk daftar penerima yang diizinkan.");
      recipients = [{ prospectId: null, name: "Bapak/Ibu", email: admin.email, company: "BinaHub" }];
    } else {
      if (!input.prospectIds.length || new Set(input.prospectIds).size !== input.prospectIds.length) throw new OutboundBlockedError("Pilih 1–50 target yang berbeda.");
      const testJobs = await db.from("outbound_email_jobs").select("id,outbound_email_deliveries(status,email)").eq("campaign_id", input.campaignId).eq("kind", "test").eq("requested_by", admin.email).eq("template_hash", outboundTemplateHash(template)).eq("locale", input.locale).gte("created_at", new Date(Date.now() - 24 * 60 * 60_000).toISOString()).limit(100);
      if (testJobs.error) throw new Error(testJobs.error.message);
      if (!(testJobs.data || []).some((job) => job.outbound_email_deliveries.some((row: { status: string; email: string }) => row.status === "sent" && row.email === admin.email))) throw new OutboundBlockedError("Kirim email uji terlebih dahulu menggunakan template ini (berlaku 24 jam).");
      const targets = await campaignTargets(db, input.campaignId);
      const batchMap = new Map(targets.batches.map((batch) => [batch.id, batch]));
      recipients = input.prospectIds.map((id) => {
        const prospect = targets.prospects.find((row) => row.id === id);
        if (!prospect) throw new OutboundBlockedError("Target tidak ditemukan dalam kampanye ini.");
        const blocker = recipientBlocker(prospect, context.source, input.campaignId, batchMap.get(prospect.batch_id), context.audience, targets.suppressed);
        if (blocker) throw new OutboundBlockedError(`${prospect.email}: ${blocker}.`);
        return { prospectId: prospect.id, name: prospect.name, email: prospect.email, company: prospect.company };
      });
    }
    const queued = await db.rpc("queue_outbound_email", { p_campaign_id: input.campaignId, p_request_key: input.requestKey, p_kind: input.action === "test" ? "test" : "initial", p_locale: input.locale, p_template_version: template.version, p_template_hash: outboundTemplateHash(template), p_subject: template.subject, p_html: template.html, p_actor: admin.email, p_recipients: recipients });
    if (queued.error) throw new Error(queued.error.message);
    const result = queued.data as { jobId: string; queued: number; duplicate: boolean };
    if (result.queued > 0) startQueue(result.jobId);
    return NextResponse.json({ success: true, ...result, message: result.queued ? `${result.queued} email masuk antrean. Pantau status di Aktivitas.` : "Permintaan sudah pernah diproses; tidak ada pengiriman ganda." }, { status: 202 });
  } catch (error) { return adminError(error instanceof Error ? error.message : "Pengiriman belum dapat diproses.", error instanceof OutboundBlockedError ? 409 : 503, "OUTBOUND_EMAIL_BLOCKED"); }
}
