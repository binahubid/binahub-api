import { ASSESSMENT_QUESTION_IDS, DIMENSIONS } from "@/lib/validations";

export type ProposalEligibility = {
  eligible: boolean;
  missing: string[];
  summary: string;
};

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value));
}

export function evaluateAssessmentProposalEligibility(input: {
  formData: unknown;
  scores: unknown;
  category?: string | null;
  aiAnalysis?: string | null;
  recommendations: unknown;
  overallScore?: number | null;
}): ProposalEligibility {
  const form = asObject(input.formData);
  const scores = asObject(input.scores);
  const recommendations = asArray(input.recommendations);
  const missing: string[] = [];

  if (text(form.name).length < 2) missing.push("nama penerima");
  if (!validEmail(form.email)) missing.push("email penerima yang valid");
  if (text(form.company).length < 2) missing.push("nama organisasi");
  const answers = asObject(form.answers);
  const completeAnswers = ASSESSMENT_QUESTION_IDS.every((questionId) => {
    const answer = Number(answers[questionId]);
    return Number.isInteger(answer) && answer >= 1 && answer <= 5;
  });
  if (!completeAnswers) missing.push("jawaban 49 pertanyaan assessment");

  const completeScores = DIMENSIONS.every((dimension) => Number.isFinite(Number(scores[dimension])));
  const overall = Number(scores.overall ?? input.overallScore);
  if (!completeScores || !Number.isFinite(overall)) missing.push("skor seluruh dimensi assessment");
  if (text(input.category).length < 2) missing.push("kategori hasil assessment");
  if (text(input.aiAnalysis).length < 80) missing.push("analisis hasil assessment");

  const completeRecommendations = recommendations.filter((entry) => {
    const recommendation = asObject(entry);
    return text(recommendation.title).length >= 3
      && text(recommendation.description).length >= 20
      && text(recommendation.service).length >= 2;
  });
  if (completeRecommendations.length < 3) missing.push("minimal tiga rekomendasi lengkap");

  return {
    eligible: missing.length === 0,
    missing,
    summary: missing.length === 0
      ? "Data assessment lengkap untuk menyusun proposal standar berdasarkan katalog resmi."
      : `Belum siap: ${missing.join(", ")}.`,
  };
}

export function evaluateInquiryProposalEligibility(input: {
  name?: unknown;
  email?: unknown;
  company?: unknown;
  message?: unknown;
}): ProposalEligibility {
  const missing: string[] = [];
  if (text(input.name).length < 2) missing.push("nama kontak");
  if (!validEmail(input.email)) missing.push("email kontak yang valid");
  if (text(input.company).length < 2) missing.push("nama organisasi");
  if (text(input.message).length < 50) missing.push("kebutuhan inquiry yang cukup jelas");
  return {
    eligible: missing.length === 0,
    missing,
    summary: missing.length === 0
      ? "Konteks inquiry cukup jelas untuk menyiapkan draf awal dengan AI."
      : `Belum siap: ${missing.join(", ")}.`,
  };
}
