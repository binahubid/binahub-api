import { evaluateAssessmentProposalEligibility } from '@/lib/proposal-eligibility';
import { qualifyPublicAssessment } from '@/lib/lead-qualification';
import { assessmentAreaText } from '@/lib/assessment-area-copy';

const DIMENSIONS = ["Insights", "Lab", "Coach", "Play", "Academy", "Works", "Impact"] as const;

type Dimension = (typeof DIMENSIONS)[number];

type Scores = Record<Dimension, number> & { overall: number };

type Recommendation = {
  title?: string;
  service?: string;
  priority?: string;
  description?: string;
};

type FormData = {
  name?: string;
  email?: string;
  company?: string;
  role?: string;
  whatsapp?: string;
  employees?: string;
  industry?: string;
  location?: string;
  timeline?: string;
  budgetStatus?: string;
  sponsorStatus?: string;
  nextStepIntent?: string;
  businessConsequence?: string;
  source?: string;
  challenge?: string;
  target?: string;
  answers?: Record<string, number>;
  attribution?: Record<string, string>;
};

export type AdminAssessmentRow = {
  id: string;
  lead_id: string | null;
  form_data: unknown;
  scores: unknown;
  category: string | null;
  ai_analysis: string | null;
  recommendations: unknown;
  overall_score: number | null;
  assessment_status?: string | null;
  result_email_sent_at?: string | null;
  result_email_id?: string | null;
  proposal_status?: string | null;
  proposal_sent_at?: string | null;
  proposal_email_id?: string | null;
  proposal_requested_at?: string | null;
  result_follow_up_level?: number | null;
  result_follow_up_sent_at?: string | null;
  result_follow_up_email_id?: string | null;
  proposal_follow_up_level?: number | null;
  proposal_follow_up_sent_at?: string | null;
  proposal_follow_up_email_id?: string | null;
  follow_up_history?: unknown;
  follow_up_paused?: boolean | null;
  proposal_data?: unknown;
  proposal_draft_data?: unknown;
  proposal_gate_status?: string | null;
  proposal_gate_reasons?: unknown;
  proposal_catalog_version?: string | null;
  proposal_generated_at?: string | null;
  proposal_approved_at?: string | null;
  proposal_approved_by?: string | null;
  created_at: string;
};


export type AdminAssessmentLead = { name?: string | null; email?: string | null; company?: string | null; phone?: string | null; industry?: string | null; location?: string | null; source?: string | null; source_metadata?: unknown; lead_score_rule_version?: string | null; lifecycle_stage?: string | null; opportunity_stage?: string | null };

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

function normalizeScore(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue) : 0;
}

function getScores(value: unknown, overallScore?: number | null): Scores {
  const parsed = parseJson<Partial<Scores>>(value, {});
  const scores = Object.fromEntries(
    DIMENSIONS.map((dimension) => [dimension, normalizeScore(parsed[dimension])])
  ) as Record<Dimension, number>;

  return {
    ...scores,
    overall: normalizeScore(parsed.overall ?? overallScore),
  };
}

function getRecommendations(value: unknown): Recommendation[] {
  const parsed = parseJson<Recommendation[]>(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

function getFormData(value: unknown): FormData {
  return parseJson<FormData>(value, {});
}


export function mapAdminAssessment(row: AdminAssessmentRow, lead?: AdminAssessmentLead) {
    const form = getFormData(row.form_data);
    const scores = getScores(row.scores, row.overall_score);
    const recommendations = getRecommendations(row.recommendations);
    // Per-assessment, read-only recalculation. Never overwrite historical lead scores in a GET.
    const qualification = qualifyPublicAssessment({ ...form }, Object.keys(form.answers || {}).length === 49);
    const proposalEligibility = evaluateAssessmentProposalEligibility({
      formData: row.form_data,
      scores: row.scores,
      category: row.category,
      aiAnalysis: row.ai_analysis ? assessmentAreaText(row.ai_analysis) : row.ai_analysis,
      recommendations: row.recommendations,
      overallScore: row.overall_score,
    });

    return {
      id: row.id,
      leadId: row.lead_id,
      name: form.name || lead?.name || "-",
      email: form.email || lead?.email || "-",
      company: form.company || lead?.company || "-",
      role: form.role || "-",
      whatsapp: form.whatsapp || lead?.phone || "",
      employees: form.employees || "Tidak diketahui",
      industry: form.industry || lead?.industry || "",
      location: form.location || lead?.location || "",
      timeline: form.timeline || "unknown",
      budgetStatus: form.budgetStatus || "unknown",
      sponsorStatus: form.sponsorStatus || "unknown",
      nextStepIntent: form.nextStepIntent || "explore",
      businessConsequence: form.businessConsequence || "",
      source: form.source || lead?.source || "insight_assessment",
      challenge: form.challenge || "",
      target: form.target || "",
      scores,
      category: row.category || "Tidak diketahui",
      aiAnalysis: assessmentAreaText(row.ai_analysis || ""),
      recommendations,
      proposalEligibility,
      answers: form.answers || {},
      overallScore: scores.overall,
      assessmentStatus: row.assessment_status || (row.result_email_sent_at ? "Result Email Terkirim" : "Result Otomatis Terkirim"),
      resultEmailSentAt: row.result_email_sent_at || null,
      resultEmailId: row.result_email_id || null,
      proposalStatus: row.proposal_status || "Belum Diminta",
      proposalRequestedAt: row.proposal_requested_at || null,
      proposalSentAt: row.proposal_sent_at || null,
      proposalEmailId: row.proposal_email_id || null,
      proposalDraft: row.proposal_draft_data || null,
      proposalGateStatus: row.proposal_gate_status || "not_evaluated",
      proposalGateReasons: Array.isArray(row.proposal_gate_reasons) ? row.proposal_gate_reasons : [],
      proposalCatalogVersion: row.proposal_catalog_version || null,
      proposalGeneratedAt: row.proposal_generated_at || null,
      proposalApprovedAt: row.proposal_approved_at || null,
      proposalApprovedBy: row.proposal_approved_by || null,
      resultFollowUpLevel: row.result_follow_up_level || 0,
      resultFollowUpSentAt: row.result_follow_up_sent_at || null,
      proposalFollowUpLevel: row.proposal_follow_up_level || 0,
      proposalFollowUpSentAt: row.proposal_follow_up_sent_at || null,
      followUpPaused: row.follow_up_paused === true,
      leadScore: qualification.score,
      leadStatus: qualification.temperature,
      leadTemperature: qualification.temperature,
      leadScoreConfidence: qualification.confidence,
      leadScoreReason: qualification.reasoning,
      leadScoreEvidence: qualification,
      leadScoreRuleVersion: qualification.ruleVersion,
      recordedLeadScoreRuleVersion: lead?.lead_score_rule_version || null,
      lifecycleStage: lead?.lifecycle_stage || "prospect",
      opportunityStage: lead?.opportunity_stage || "identified",
      attribution: form.attribution || (lead?.source_metadata as Record<string, string> | undefined) || {},
      createdAt: row.created_at,
    };
}
