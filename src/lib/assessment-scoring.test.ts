import { describe, expect, it } from "vitest";
import { ASSESSMENT_QUESTION_IDS } from "./validations";
import { calculateAssessmentScores, getAssessmentCategory } from "./assessment-scoring";

describe("assessment scoring", () => {
  it.each([
    [1, 20],
    [3, 60],
    [5, 100],
  ])("maps a uniform Likert value of %i to %i percent", (likert, expected) => {
    const answers = Object.fromEntries(ASSESSMENT_QUESTION_IDS.map((id) => [id, likert]));
    const scores = calculateAssessmentScores(answers);

    expect(scores.overall).toBe(expected);
    expect(Object.values(scores).every((score) => score === expected)).toBe(true);
  });

  it.each([
    [39, "Pemula", "Starter"],
    [40, "Berkembang", "Developing"],
    [60, "Berkembang", "Developing"],
    [61, "Profesional", "Professional"],
    [80, "Profesional", "Professional"],
    [81, "Unggulan", "Leading"],
  ])("uses deterministic category boundaries for score %i", (score, id, en) => {
    expect(getAssessmentCategory(score, "id")).toBe(id);
    expect(getAssessmentCategory(score, "en")).toBe(en);
  });
});
