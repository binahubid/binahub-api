import type { AssessmentData } from "./validations";
import { DIMENSIONS } from "./validations";

export type AssessmentLocale = "id" | "en";

export function calculateAssessmentScores(answers: AssessmentData["answers"]) {
  const dimensionScores = Object.fromEntries(
    DIMENSIONS.map((dimension, dimensionIndex) => {
      const firstQuestion = dimensionIndex * 7 + 1;
      const total = Array.from({ length: 7 }, (_, offset) => answers[String(firstQuestion + offset)])
        .reduce((sum, value) => sum + value, 0);
      return [dimension, Math.round((total / 35) * 100)];
    }),
  ) as Record<(typeof DIMENSIONS)[number], number>;

  const overallTotal = Object.values(answers).reduce((sum, value) => sum + value, 0);
  return {
    ...dimensionScores,
    overall: Math.round((overallTotal / 245) * 100),
  };
}

export function getAssessmentCategory(score: number, locale: AssessmentLocale) {
  if (locale === "en") {
    if (score > 80) return "Leading";
    if (score >= 61) return "Professional";
    if (score >= 40) return "Developing";
    return "Starter";
  }

  if (score > 80) return "Unggulan";
  if (score >= 61) return "Profesional";
  if (score >= 40) return "Berkembang";
  return "Pemula";
}
