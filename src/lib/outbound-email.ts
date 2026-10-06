import { createHash } from "node:crypto";
import { createServerSupabase } from "./supabase";
import { loadApprovedOutreachTemplate, type ApprovedOutreachTemplate } from "./outreach-template";
import { loadOutboundSettings, outboundAudience, outboundEmergencyStopped } from "./outbound-settings";
import { createOutboundCampaignToken, outboundCampaignTokenDigest, outboundLinkSigningReady } from "./outbound-campaign-links";
import { renderApprovedOutreachHtml } from "./email-template-renderer";
import { evaluateFollowUpWindow } from "./follow-up-policy";
import { sendOutreachEmail, OutreachSuppressedError } from "./email-service";

type Db = ReturnType<typeof createServerSupabase>;
export type OutboundProspect = { id: string; batch_id: string; source_id: string; campaign_id: string | null; name: string; email: string; company: string | null; consent_status: string; validation_status: string };
export type OutboundDelivery = { id: string; job_id: string; campaign_id: string; prospect_id: string | null; kind: "test" | "initial"; email: string; name: string; company: string | null };
export class OutboundBlockedError extends Error {}
const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

export function outboundTemplateHash(template: Pick<ApprovedOutreachTemplate, "version" | "subject" | "html">) {
  return createHash("sha256").update(JSON.stringify([template.version, template.subject, template.html])).digest("hex");
}

/** Only the approved diagnostic CTA is replaced; company-site links stay intact. */
export function renderInitialOutreach(template: Pick<ApprovedOutreachTemplate, "subject" | "html">, recipient: { name: string; company: string | null }, trackingUrl: string) {
  if (!/^https:\/\//.test(trackingUrl)) throw new OutboundBlockedError("Tautan email harus HTTPS.");
  const substitutions = { name: recipient.name, company: recipient.company || "Perusahaan Anda" };
  let subject = template.subject;
  let html = template.html;
  for (const [key, value] of Object.entries(substitutions)) {
    subject = subject.replaceAll(`{{${key}}}`, value.replace(/[\r\n]/g, " "));
    html = html.replaceAll(`{{${key}}}`, escape(value));
  }
  let replaced = 0;
  html = html.replace(/href=(["'])https:\/\/(?:www\.)?binahub\.id\/(?:(?:id|en)\/)?(?:diagnosa|insight)\/?(?:\?[^"']*)?\1/gi, (_match, quote) => {
    replaced += 1;
    return `href=${quote}${escape(trackingUrl)}${quote}`;
  });
  html = html.replaceAll("{{assessment_url}}", escape(trackingUrl));
  if (!replaced && !template.html.includes("{{assessment_url}}")) throw new OutboundBlockedError("Template email belum memiliki tautan diagnosa yang dapat dilacak.");
  if (/{{[^}]+}}/.test(html + subject)) throw new OutboundBlockedError("Template email memiliki variabel yang belum didukung.");
  return { subject: subject.replace(/[\r\n]+/g, " ").slice(0, 300), html, previewHtml: renderApprovedOutreachHtml(html) };
}

export async function loadOutboundContext(db: Db, campaignId: string, locale: "id" | "en") {
  const campaignResult = await db.from("acquisition_campaigns").select("*").eq("id", campaignId).maybeSingle();
  if (campaignResult.error) throw new Error(campaignResult.error.message);
  const campaign = campaignResult.data;
  if (!campaign) throw new OutboundBlockedError("Kampanye tidak ditemukan.");
  const [sourceResult, template, settings] = await Promise.all([
    db.from("acquisition_sources").select("*").eq("id", campaign.source_id).maybeSingle(),
    loadApprovedOutreachTemplate(db, "marketing_blast_initial", locale),
    loadOutboundSettings(db, campaignId),
  ]);
  if (sourceResult.error) throw new Error(sourceResult.error.message);
  const source = sourceResult.data;
  const blockers: string[] = [];
  if (outboundEmergencyStopped()) blockers.push("Pengiriman dihentikan sementara oleh tim teknis. Hubungi penanggung jawab.");
  if (!outboundLinkSigningReady()) blockers.push("Pelacakan tautan belum dikonfigurasi.");
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM?.includes("@") || process.env.EMAIL_FROM?.includes("resend.dev")) blockers.push("Pengirim email bisnis belum dikonfigurasi.");
  if ((process.env.UNSUBSCRIBE_SECRET?.length || 0) < 32) blockers.push("Tautan berhenti berlangganan belum dikonfigurasi.");
  if (!/^https:\/\//.test(process.env.NEXT_PUBLIC_BINAHUB_API_URL || "")) blockers.push("Alamat API HTTPS belum dikonfigurasi.");
  if (campaign.channel !== "email" || !["approved", "active"].includes(campaign.status) || !campaign.approved_by || !campaign.approved_at) blockers.push("Pilih kampanye Email yang sudah disetujui.");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  if (campaign.status === "active" && (!campaign.starts_on || !campaign.ends_on || today < campaign.starts_on || today > campaign.ends_on)) blockers.push("Kampanye tidak berada dalam jadwal aktifnya.");
  if (!source || source.status !== "approved" || !source.active || source.channel !== "outbound" || !source.approved_by || !source.approved_at || !source.privacy_notice_url || !source.retention_days || !source.data_owner || !source.legal_owner || !["consent", "legitimate_interest"].includes(source.lawful_basis)) blockers.push("Sumber outbound dan persetujuan penggunaan data belum lengkap.");
  if (!template || !template.owner) blockers.push("Template email pertama belum disetujui atau belum memiliki penanggung jawab.");
  const setupBlockers = [...blockers];
  if (!settings.enabled) blockers.push("Pengiriman kampanye dijeda. Atur pengiriman dari halaman ini.");
  if (settings.recipientMode === "restricted" && !settings.allowedEmails.length) blockers.push("Tambahkan alamat uji pada Pengaturan pengiriman.");
  return { campaign, source, template, settings, audience: outboundAudience(settings), setupBlockers, blockers, ready: blockers.length === 0 };
}

export function recipientBlocker(prospect: OutboundProspect, source: { id: string; lawful_basis: string; retention_days: number }, campaignId: string, batch: { status: string; approved_by: string | null; approved_at: string | null; created_at: string } | undefined, audience: ReadonlySet<string> | null, suppressed: ReadonlySet<string>) {
  if (prospect.source_id !== source.id || prospect.campaign_id !== campaignId) return "Sumber atau kampanye tidak sesuai";
  if (prospect.validation_status !== "valid") return "Tidak lolos validasi data";
  if (prospect.consent_status === "opted_out" || suppressed.has(prospect.email.trim().toLowerCase())) return "Tidak boleh dihubungi";
  if (source.lawful_basis === "consent" && prospect.consent_status !== "opted_in") return "Persetujuan penerima belum tersedia";
  if (!batch || !["approved", "processing", "completed"].includes(batch.status) || !batch.approved_by || !batch.approved_at) return "Daftar target belum disetujui";
  if (Date.now() - Date.parse(batch.created_at) > source.retention_days * 86_400_000 || !Number.isFinite(Date.parse(batch.created_at))) return "Masa penggunaan data berakhir";
  if (audience && !audience.has(prospect.email.trim().toLowerCase())) return "Di luar alamat uji. Tambahkan pada Pengaturan pengiriman atau pilih Target disetujui.";
  return null;
}

export async function processOutboundQueue(jobId?: string, campaignId?: string) {
  const db = createServerSupabase();
  if (outboundEmergencyStopped()) return { processed: 0, deferred: true, reason: "Pengiriman dihentikan sementara oleh tim teknis." };
  // SQL checks campaign activation, audience version and optional send window before claiming.
  const claimed = await db.rpc("claim_outbound_email", { p_job_id: jobId || null, p_limit: 10, p_campaign_id: campaignId || null });
  if (claimed.error) throw new Error(claimed.error.message);
  let processed = 0;
  for (const delivery of (claimed.data || []) as OutboundDelivery[]) {
    let attempted = false;
    try {
      const jobResult = await db.from("outbound_email_jobs").select("*").eq("id", delivery.job_id).single();
      if (jobResult.error || !jobResult.data) throw new Error("Antrean email tidak dapat dibaca.");
      const job = jobResult.data;
      const context = await loadOutboundContext(db, job.campaign_id, job.locale);
      if (!context.ready || !context.template) throw new OutboundBlockedError(context.blockers.join(" "));
      if (job.settings_version !== context.settings.version) throw new OutboundBlockedError("Pengaturan pengiriman berubah. Antrean lama tidak dikirim otomatis.");
      if (delivery.kind === "initial" && context.settings.businessHoursOnly && !evaluateFollowUpWindow().allowed) throw new OutboundBlockedError("Di luar jam pengiriman yang ditetapkan.");
      if (outboundTemplateHash(context.template) !== job.template_hash) throw new OutboundBlockedError("Template berubah. Tinjau kembali kampanye sebelum pengiriman lain.");
      if (delivery.kind === "initial" && context.audience && !context.audience.has(delivery.email)) throw new OutboundBlockedError("Penerima tidak lagi diizinkan.");
      if (delivery.kind === "test" && delivery.email !== job.requested_by) throw new OutboundBlockedError("Email uji hanya boleh dikirim ke admin peminta.");
      let prospect: OutboundProspect | null = null;
      if (delivery.kind === "initial") {
        const prospectResult = await db.from("acquisition_prospects").select("*").eq("id", delivery.prospect_id).single();
        if (prospectResult.error || !prospectResult.data) throw new Error("Data penerima tidak dapat dibaca.");
        prospect = prospectResult.data;
        if (!prospect || prospect.email !== delivery.email) throw new OutboundBlockedError("Alamat target berubah.");
        const batchResult = await db.from("prospect_import_batches").select("status,approved_by,approved_at,created_at").eq("id", prospect.batch_id).single();
        if (batchResult.error) throw new Error(batchResult.error.message);
        const blocker = recipientBlocker(prospect, context.source, job.campaign_id, batchResult.data, context.audience, new Set());
        if (blocker) throw new OutboundBlockedError(blocker);
      }
      const token = createOutboundCampaignToken();
      const linkResult = await db.from("outbound_campaign_links").insert({ source_id: context.source.id, campaign_id: job.campaign_id, prospect_id: prospect?.id || null, batch_id: prospect?.batch_id || null, token_digest: outboundCampaignTokenDigest(token), status: "active", is_test: delivery.kind === "test", destination_path: job.locale === "en" ? "/en/insight" : "/insight", expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(), issued_by: job.requested_by }).select("id").single();
      if (linkResult.error || !linkResult.data) throw new Error("Tautan pelacakan gagal disimpan.");
      const content = renderInitialOutreach(context.template, delivery, `${process.env.NEXT_PUBLIC_BINAHUB_API_URL!.replace(/\/$/, "")}/api/acquisition/c/${token}`);
      const linked = await db.from("outbound_email_deliveries").update({ link_id: linkResult.data.id }).eq("id", delivery.id).eq("status", "processing");
      if (linked.error) throw new Error(linked.error.message);
      // Final read reduces the pause/revoke race during template/link preparation.
      const latest = await loadOutboundSettings(db, job.campaign_id);
      if (outboundEmergencyStopped() || !latest.enabled || latest.version !== job.settings_version) throw new OutboundBlockedError("Pengiriman dijeda atau pengaturan berubah sebelum dikirim.");
      attempted = true;
      const result = await sendOutreachEmail(delivery.email, delivery.name, delivery.kind === "test" ? `[UJI] ${content.subject}` : content.subject, content.html, delivery.company || undefined, { idempotencyKey: `outbound-initial-${delivery.id}`, category: "marketing_initial" });
      if (!result.data?.id) throw new Error("Respons penyedia email belum memiliki bukti penerimaan. Periksa arsip pengiriman.");
      const saved = await db.from("outbound_email_deliveries").update({ status: "sent", provider_email_id: result.data?.id || null, updated_at: new Date().toISOString() }).eq("id", delivery.id).eq("status", "processing");
      if (saved.error) throw new Error(saved.error.message);
      processed += 1;
    } catch (error) {
      // Timeouts and interrupted provider responses cannot safely be assumed to be failures.
      const uncertain = attempted && !(error instanceof OutreachSuppressedError);
      const saved = await db.from("outbound_email_deliveries").update({ status: uncertain ? "uncertain" : "blocked", error_message: error instanceof Error ? error.message : "Pengiriman perlu diperiksa.", updated_at: new Date().toISOString() }).eq("id", delivery.id).eq("status", "processing");
      if (saved.error) throw new Error(saved.error.message);
    }
  }
  return { processed, deferred: false };
}
