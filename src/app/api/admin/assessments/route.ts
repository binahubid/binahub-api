import { after, NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { sendAssessmentEmail, sendProposalEmail } from "@/lib/email-service";
import { generatePDFBuffer, AssessmentResult, type ProposalResult } from "@/lib/pdf-service";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { assessmentActionSchema, assessmentStatusUpdateSchema } from "@/lib/admin-mutation-schemas";
import { requestStandardProposal } from "@/lib/standard-proposal-request";
import { createAndSendAutomaticPreliminary } from "@/lib/automatic-preliminary";
import { recordRuntimeError } from "@/lib/runtime-observability";

export const runtime = "nodejs";
export const maxDuration = 120;

type AssessmentRow = {
  id: string;
  lead_id: string | null;
  form_data: unknown;
  scores: unknown;
  category: string | null;
  ai_analysis: string | null;
  recommendations: unknown;
  overall_score: number | null;
  proposal_draft_data: unknown;
  proposal_gate_status: string | null;
  proposal_catalog_version: string | null;
  proposal_sent_at: string | null;
  proposal_status: string | null;
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

async function getAssessment(id: string) {
  const db = createServerSupabase();
  const { data, error } = await db
    .from("assessments")
    .select("id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, proposal_draft_data, proposal_gate_status, proposal_catalog_version, proposal_sent_at, proposal_status")
    .eq("id", id)
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Assessment tidak ditemukan.");
  }

  return data;
}

function buildResult(row: AssessmentRow): AssessmentResult {
  const scores = parseJson<Record<string, number>>(row.scores, {});
  return {
    scores: { ...scores, overall: Number(scores.overall || row.overall_score || 0) } as AssessmentResult["scores"],
    category: row.category || "Belum dikategorikan",
    aiAnalysis: row.ai_analysis || "",
    recommendations: parseJson(row.recommendations, []),
  };
}

async function updateAssessmentWithEmailIds(
  db: ReturnType<typeof createServerSupabase>,
  id: string,
  payload: Record<string, unknown>,
  fallbackPayload: Record<string, unknown>
) {
  const { error } = await db.from("assessments").update(payload).eq("id", id);
  if (!error) return;

  const { error: fallbackError } = await db.from("assessments").update(fallbackPayload).eq("id", id);
  if (fallbackError) {
    throw fallbackError;
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, assessmentStatusUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_ASSESSMENT_STATUS");
  const { id, assessmentStatus, proposalStatus, followUpPaused } = parsed.data;

  const db = createServerSupabase();
  const current = await db.from("assessments").select("proposal_status,proposal_draft_data").eq("id", id).single();
  if (current.error || !current.data) return adminError("Assessment belum dapat dibaca. Muat ulang sebelum mengubah status.", 409, "ASSESSMENT_STATUS_UNAVAILABLE");
  const observedStatus = current.data.proposal_status;
  const currentDraft = parseJson<Record<string, unknown>>(current.data.proposal_draft_data, {});
  const hasManualDraft = Boolean(currentDraft.proposal && currentDraft.automatic !== true);
  const deliveryManagedStatuses = ["Gagal Otomatis", "Perlu Rekonsiliasi", ...(!hasManualDraft ? ["Sedang Disusun"] : [])];
  if (proposalStatus !== observedStatus && (deliveryManagedStatuses.includes(observedStatus) || deliveryManagedStatuses.includes(proposalStatus))) {
    return adminError("Status proses otomatis tidak dapat diubah manual. Gunakan tindakan proposal standar atau periksa arsip email untuk rekonsiliasi.", 409, "PROPOSAL_DELIVERY_STATUS_PROTECTED");
  }
  let update = db
    .from("assessments")
    .update({
      assessment_status: assessmentStatus,
      proposal_status: proposalStatus,
      ...(followUpPaused === undefined ? {} : { follow_up_paused: followUpPaused }),
    })
    .eq("id", id);
  update = observedStatus ? update.eq("proposal_status", observedStatus) : update.is("proposal_status", null);
  const { data, error } = await update.select().maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!data) return adminError("Status assessment berubah selama proses. Muat ulang dan coba kembali.", 409, "ASSESSMENT_STATUS_CHANGED");

  return NextResponse.json({ success: true, assessment: data });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, assessmentActionSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_ASSESSMENT_ACTION");
  const { id, action } = parsed.data;

  const db = createServerSupabase();

  try {
    const row = await getAssessment(id);
    const formData = parseJson<Parameters<typeof generatePDFBuffer>[0]>(row.form_data, {} as Parameters<typeof generatePDFBuffer>[0]);
    const result = buildResult(row);

    if (action === "resend_result") {
      const pdfBuffer = await generatePDFBuffer(formData, result);
      const locale = formData.locale === "en" ? "en" : "id";
      const emailIds = await sendAssessmentEmail(formData, result, pdfBuffer, id, locale);
      const sentAt = new Date().toISOString();
      await updateAssessmentWithEmailIds(
        db,
        id,
        {
          assessment_status: "Result Email Terkirim",
          result_email_sent_at: sentAt,
          result_email_id: emailIds?.clientEmailId || null,
        },
        {
          assessment_status: "Result Email Terkirim",
          result_email_sent_at: sentAt,
        }
      );
      return NextResponse.json({ success: true });
    }

    if (action === "request_proposal") {
      if (row.proposal_sent_at) return adminError("Proposal sudah dikirim. Jangan membuat permintaan duplikat.", 409, "PROPOSAL_ALREADY_SENT");
      const requested = await requestStandardProposal(id, true);
      if (requested.outcome === "sent") return adminError("Proposal sudah dikirim.", 409, "PROPOSAL_ALREADY_SENT");
      if (requested.outcome === "manual_review") return adminError("Periksa draf atau rekonsiliasi pengiriman sebelum menjalankan ulang. Draf manual tidak akan ditimpa.", 409, "PROPOSAL_REVIEW_REQUIRED");
      if (requested.outcome === "queued") {
        after(async () => {
          try { await createAndSendAutomaticPreliminary(id, requested.requestedAt); }
          catch (error) { await recordRuntimeError({ code: "STANDARD_PROPOSAL_BACKGROUND_FAILED", message: error instanceof Error ? error.message : String(error), route: "/api/admin/assessments" }); }
        });
      }
      await logAdminEvent(db, { eventType: "standard_proposal_requested", targetType: "assessment", targetId: id, actor: admin.email, status: "Queued", message: "Proposal standar dijadwalkan untuk dibuat dan dikirim otomatis." });
      return NextResponse.json({ success: true, outcome: requested.outcome }, { status: 202 });
    }

    if (action === "send_proposal") {
      if (row.proposal_sent_at) return adminError("Proposal sudah dikirim. Periksa riwayat sebelum mengirim ulang.", 409, "PROPOSAL_ALREADY_SENT");
      const draft = parseJson<Record<string, unknown>>(row.proposal_draft_data, {});
      const hasManualDraft = Boolean(draft.proposal && draft.automatic !== true);
      if (["Perlu Rekonsiliasi", "Gagal Otomatis"].includes(row.proposal_status || "") || row.proposal_status === "Sedang Disusun" && !hasManualDraft) return adminError("Proposal otomatis harus diselesaikan atau direkonsiliasi melalui alur standar, bukan dikirim ulang secara manual.", 409, "AUTOMATIC_PROPOSAL_IN_PROGRESS");
      if (!['approved', 'clear'].includes(row.proposal_gate_status || '')) {
        return adminError("Proposal belum lolos Human Gate. Buat draft dan selesaikan approval terlebih dahulu.", 409, "PROPOSAL_GATE_BLOCKED");
      }
      const proposal = draft.proposal as ProposalResult | undefined;
      if (!proposal) {
        return adminError("Snapshot draft proposal tidak ditemukan. Buat ulang draft dari katalog modul.", 409, "PROPOSAL_DRAFT_MISSING");
      }
      const isSimulation = draft.isSimulation === true;
      if (isSimulation && process.env.ALLOW_MOCK_PROPOSAL_SEND !== "true") {
        return adminError("Proposal simulasi tidak boleh dikirim. Ganti mock dengan katalog resmi atau aktifkan izin demo secara eksplisit.", 409, "MOCK_PROPOSAL_SEND_DISABLED");
      }

      const locale = formData.locale === "en" ? "en" : "id";
      const proposalEmail = await sendProposalEmail(formData.email, formData.name, formData.company, proposal, id, locale, `assessment-${id}-approved-proposal-v2`);
      const sentAt = new Date().toISOString();
      await updateAssessmentWithEmailIds(
        db,
        id,
        {
          assessment_status: "Proposal Terkirim",
          proposal_status: "Terkirim",
          proposal_sent_at: sentAt,
          proposal_data: proposal,
          proposal_email_id: proposalEmail.data?.id || null,
        },
        {
          assessment_status: "Proposal Terkirim",
          proposal_status: "Terkirim",
          proposal_sent_at: sentAt,
          proposal_data: proposal,
        }
      );

      if (row.lead_id) {
        await db.from("leads").update({
          lifecycle_stage: "lead",
          opportunity_stage: "proposal",
          last_meaningful_activity_at: sentAt,
        }).eq("id", row.lead_id);
      }
      await logAdminEvent(db, {
        eventType: "proposal_sent",
        targetType: "assessment",
        targetId: id,
        actor: admin.email,
        payload: { catalogVersion: row.proposal_catalog_version, isSimulation },
        status: "Sent",
        message: `Proposal tervalidasi dikirim oleh ${admin.email}.`,
      });

      return NextResponse.json({ success: true, proposal });
    }

    return adminError("Action assessment tidak dikenal.", 400, "INVALID_ASSESSMENT_ACTION");
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memproses assessment." },
      { status: 500 }
    );
  }
}
