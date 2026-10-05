import { createServerSupabase } from "./supabase";

function draftObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return draftObject(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function requestStandardProposal(assessmentId: string, allowManualRetry = false) {
  const db = createServerSupabase();
  const { data: assessment, error } = await db.from("assessments")
    .select("id,proposal_status,proposal_sent_at,proposal_requested_at,proposal_draft_data,form_data")
    .eq("id", assessmentId).single();
  if (error || !assessment) throw new Error(error?.message || "Assessment tidak ditemukan.");
  if (assessment.proposal_sent_at || assessment.proposal_status === "Terkirim") return { outcome: "sent" as const, assessment };
  const draft = draftObject(assessment.proposal_draft_data);
  if (draft?.proposal && draft.automatic !== true) return { outcome: "manual_review" as const, assessment };
  if (assessment.proposal_status === "Sedang Disusun") return { outcome: "processing" as const, assessment };
  const requestable = ["Belum Diminta", "Diminta", "Gagal Otomatis", ...(allowManualRetry ? ["Menunggu Approval"] : [])];
  if (assessment.proposal_status && !requestable.includes(assessment.proposal_status)) return { outcome: "manual_review" as const, assessment };
  const requestedAt = assessment.proposal_requested_at || new Date().toISOString();
  let update = db.from("assessments").update({ assessment_status: "Minta Proposal", proposal_status: "Diminta", proposal_requested_at: requestedAt }).eq("id", assessmentId).is("proposal_sent_at", null);
  update = assessment.proposal_status ? update.eq("proposal_status", assessment.proposal_status) : update.is("proposal_status", null);
  const claimed = await update.select("id").maybeSingle();
  if (claimed.error) throw new Error(claimed.error.message);
  if (!claimed.data) return { outcome: "processing" as const, assessment };
  return { outcome: "queued" as const, assessment, requestedAt };
}
