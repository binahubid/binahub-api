import "server-only";
import { createServerSupabase } from "@/lib/supabase";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
import { SPIN_DEFINITION, validateSpinAnswers, spinInternalRules, spinNeeds } from "@/lib/spin/intake";
import { SpinReportSchema } from "@/lib/spin/report";
import { ConsultantError } from "./http";
import type { ConsultantDetail } from "./schemas";

export async function readConsultantRecommendation(detail: ConsultantDetail, includePdf = false) {
  const db = createServerSupabase();
  const sourceId = detail.workspace?.source_id;
  let query = db.from("spin_submissions").select("id, status, submitted_at, report, question_version, answers")
    .eq("lead_id", detail.record.id)
    .eq("contact->>email", detail.record.email.trim().toLowerCase())
    .not("submitted_at", "is", null);
  if (sourceId) query = query.eq("id", sourceId);
  const { data: source, error } = await query.order("submitted_at", { ascending: false })
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new ConsultantError("CONSULTANT_RECOMMENDATION_UNAVAILABLE", 503);
  if (!source) return null;

  const report = SpinReportSchema.safeParse(source.report).data;
  const { data, error: deliveryError } = await db.from("spin_mail_jobs")
    .select(includePdf ? "status, sent_at, pdf_base64" : "status, sent_at")
    .eq("submission_id", source.id)
    .eq("recipient", detail.record.email.trim().toLowerCase())
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false }).limit(1).maybeSingle()
    .overrideTypes<{ status: string; sent_at: string | null; pdf_base64?: string | null }, { merge: false }>();
  if (deliveryError) throw new ConsultantError("CONSULTANT_RECOMMENDATION_UNAVAILABLE", 503);
  const sentAt = data?.status === "sent" ? data.sent_at : null;
  const pdf = sentAt ? data?.pdf_base64 ?? null : null;
  return { source, report, sentAt, delivery: data?.status ?? null, pdf };
}

type InitialRecommendation = NonNullable<Awaited<ReturnType<typeof readConsultantRecommendation>>>;

export function canUseClientAnswers(detail: ConsultantDetail, initial: InitialRecommendation) {
  const w = detail.workspace;
  if (!detail.record.canEdit || !w || w.checklist_status === "completed"
    || Object.keys(w.answers).length !== 0 || w.notes.trim()
    || initial.source.question_version !== SPIN_DEFINITION.version) return false;
  try {
    validateSpinAnswers(initial.source.answers, true);
    return true;
  } catch {
    return false;
  }
}

export function recommendationCard(detail: ConsultantDetail, initial: InitialRecommendation) {
  const programs = initial.report?.solutions.length ? initial.report.solutions : initial.report?.exploration ?? [];
  return {
    id: String(initial.source.id),
    submittedAt: String(initial.source.submitted_at),
    sentAt: initial.sentAt,
    delivery: initial.delivery,
    ready: Boolean(initial.report),
    canUseAnswers: canUseClientAnswers(detail, initial),
    programs: programs.map(({ code, name }) => ({ code, name })),
  };
}

export async function suggestConsultantPrograms(detail: ConsultantDetail, version: number) {
  if (!detail.record.canEdit) throw new ConsultantError("CONSULTANT_NOT_ASSIGNED", 403);
  const w = detail.workspace;
  if (!w || w.checklist_status !== "completed") {
    throw new ConsultantError("CONSULTANT_CHECKLIST_REQUIRED", 409);
  }
  if (w.version !== version) throw new ConsultantError("CONSULTANT_CONFLICT", 409);
  const answers = validateSpinAnswers({ ...w.original_answers, ...w.answers }, true);
  const initial = await readConsultantRecommendation(detail);
  if (initial?.report && initial.source.question_version === SPIN_DEFINITION.version
    && JSON.stringify(answers) === JSON.stringify(validateSpinAnswers(initial.source.answers))) {
    const recommended = initial.report.solutions.length > 0;
    const programs = (recommended ? initial.report.solutions : initial.report.exploration ?? [])
      .filter(({ code }) => SPIN_CATALOG.modules.some(p => p.code === code && (code !== "SS-27" || answers.spiritualOptIn === "yes")))
      .map(p => ({ code: p.code, reason: p.evidence[0]?.objective ?? "" }));
    if (programs.length) return {
      source: "initial",
      status: recommended ? "suggested" : "review",
      programs,
    };
  }
  const { prepareSpinRecommendation } = await import("@/lib/spin/service");
  const result = await prepareSpinRecommendation(spinNeeds(answers, "confirmed"));
  const rules = spinInternalRules(answers, { status: "confirmed" });
  const programs = result.publicReportDraft.recommendations.map(p => ({
    code: p.solutionCode,
    reason: p.fitEvidence[0]?.learningObjective ?? "",
  }));
  return {
    source: "checklist",
    status: programs.length ? (["A", "B"].includes(rules.fitType) && rules.confidence !== "low" ? "suggested" : "review")
      : result.internalConsultant.consultationReasons.includes("AI_MATCH_UNAVAILABLE") ? "unavailable" : "none",
    programs,
  };
}
