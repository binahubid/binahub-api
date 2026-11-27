import "server-only";
import { createServerSupabase } from "@/lib/supabase";
import { spinCatalogCandidates } from "@/lib/spin/catalog";
import { spinArray, spinSanitize, type SpinAnswers } from "@/lib/spin/form";
import { SpinNeedsSchema, spinHasRequiredEvidence, type SpinNeeds } from "@/lib/spin/recommendation";
import { SPIN_DEFINITION, SpinAnswerSchema, validateSpinAnswers, spinInternalRules, spinNeeds } from "@/lib/spin/intake";
import { SpinReportSchema } from "@/lib/spin/report";
import { ConsultantError } from "./http";
import type { ConsultantDetail } from "./schemas";

async function readRecommendationSource(detail: ConsultantDetail) {
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
  return source;
}

export async function readConsultantRecommendation(detail: ConsultantDetail, includePdf = false) {
  const source = await readRecommendationSource(detail);
  if (!source) return null;
  const report = SpinReportSchema.safeParse(source.report).data;
  const { data, error: deliveryError } = await createServerSupabase().from("spin_mail_jobs")
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

// Q05 codes are scoped to the Q04 problem cluster. Each mapping describes a
// specific catalog focus and is used only to surface options for human review.
const symptomPrograms: Record<string, Record<string, string>> = {
  C1: { S1: "SS-17", S2: "SS-17", S3: "SS-10", S4: "SS-07" },
  C2: { S1: "SS-04", S2: "SS-13", S3: "SS-12", S4: "SS-13" },
  C3: { S1: "SS-03", S2: "SS-03", S3: "SS-02", S4: "SS-03" },
  C4: { S1: "SS-05", S2: "SS-05", S3: "SS-05", S4: "SS-05" },
  C5: { S1: "SS-28", S2: "SS-28" },
  C6: { S1: "SS-06", S2: "SS-06", S3: "SS-06", S4: "SS-06" },
  C7: { S1: "SS-09", S2: "SS-24", S3: "SS-09", S4: "SS-09" },
  C8: { S1: "SS-22", S2: "SS-22", S3: "SS-29", S4: "SS-22" },
  C9: { S1: "SS-18", S2: "SS-19", S3: "SS-23", S4: "SS-23" },
  C10: { S1: "SS-31", S2: "SS-31", S3: "SS-31" },
  C11: { S1: "SS-26", S2: "SS-26", S3: "SS-26", S4: "SS-26" },
};

function catalogSuggestions(answers: SpinAnswers, needs: SpinNeeds) {
  const options = symptomPrograms[needs.problemCluster];
  if (!options || !spinHasRequiredEvidence(needs)) return [];
  const codes = [...new Set(spinArray(answers, "symptoms").map(symptom => options[symptom]))];
  const candidates = spinCatalogCandidates(needs.spiritualOptIn);
  return codes.flatMap(code => {
    const program = candidates.find(item => item.code === code);
    return program ? [{ code: program.code, reason: program.objectives[0]?.text ?? "" }] : [];
  }).slice(0, 3);
}

// Reuse a recommendation when only delivery details change. Preserve the
// headcount thresholds that affect whether a recommendation needs review.
function needsKey(needs: SpinNeeds) {
  const count = needs.participantCount;
  return JSON.stringify({ ...needs, participantCount: count === null ? null : count > 150 ? 151 : 1 });
}

export async function suggestConsultantPrograms(detail: ConsultantDetail, version: number) {
  if (!detail.record.canEdit) throw new ConsultantError("CONSULTANT_NOT_ASSIGNED", 403);
  const w = detail.workspace;
  if (!w || w.checklist_status !== "completed") {
    throw new ConsultantError("CONSULTANT_CHECKLIST_REQUIRED", 409);
  }
  if (w.version !== version) throw new ConsultantError("CONSULTANT_CONFLICT", 409);
  const answers = validateSpinAnswers({ ...w.original_answers, ...w.answers }, true);
  const needs = spinNeeds(answers, "confirmed");
  const parsed = SpinNeedsSchema.safeParse(needs);
  if (!parsed.success) return { source: "checklist", status: "none", programs: [] };
  const initial = await readRecommendationSource(detail).catch(error => {
    if (!(error instanceof ConsultantError)) throw error;
    console.warn("[Consultant] Initial source unavailable during program matching");
    return null;
  });
  if (initial?.question_version === SPIN_DEFINITION.version) {
    const report = SpinReportSchema.safeParse(initial.report).data;
    const original = SpinAnswerSchema.safeParse(initial.answers).data;
    const originalNeeds = original && SpinNeedsSchema.safeParse(
      spinNeeds(spinSanitize(SPIN_DEFINITION, original), "confirmed"),
    ).data;
    if (report && originalNeeds && needsKey(parsed.data) === needsKey(originalNeeds)) {
      const recommended = report.solutions.length > 0;
      const candidates = spinCatalogCandidates(parsed.data.spiritualOptIn);
      const programs = (recommended ? report.solutions : report.exploration ?? [])
        .filter(({ code }) => candidates.some(program => program.code === code))
        .map(program => ({ code: program.code, reason: program.evidence[0]?.objective ?? "" }));
      if (programs.length) return { source: "initial", status: recommended ? "suggested" : "review", programs };
    }
  }

  const { prepareSpinRecommendation } = await import("@/lib/spin/service");
  const result = await prepareSpinRecommendation(parsed.data);
  if (result.publicReportDraft.recommendations.length) {
    const { fitType, confidence } = spinInternalRules(answers, { status: "confirmed" });
    return {
      source: "checklist",
      status: ["A", "B"].includes(fitType) && confidence !== "low" ? "suggested" : "review",
      programs: result.publicReportDraft.recommendations.map(program => ({
        code: program.solutionCode,
        reason: program.fitEvidence[0]?.learningObjective ?? "",
      })),
    };
  }

  if (result.internalConsultant.consultationReasons.includes("AI_MATCH_UNAVAILABLE")) {
    const programs = catalogSuggestions(answers, parsed.data);
    if (programs.length) return { source: "catalog", status: "review", programs };
    return { source: "checklist", status: "unavailable", programs: [] };
  }
  return { source: "checklist", status: "none", programs: [] };
}
