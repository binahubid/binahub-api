import { describe, expect, it } from "vitest";
import { ASSESSMENT_QUESTION_IDS, AssessmentSchema } from "./validations";

const validAssessment = {
  name: "Ayu",
  email: " AYU@EXAMPLE.COM ",
  company: "Bina Contoh",
  answers: Object.fromEntries(ASSESSMENT_QUESTION_IDS.map((id) => [id, 3])),
};

describe("AssessmentSchema", () => {
  it("accepts exactly 49 Likert answers and normalizes email", () => {
    const result = AssessmentSchema.parse(validAssessment);
    expect(Object.keys(result.answers)).toHaveLength(49);
    expect(result.email).toBe("ayu@example.com");
  });

  it("rejects a missing answer", () => {
    const answers = { ...validAssessment.answers };
    delete answers["49"];
    expect(AssessmentSchema.safeParse({ ...validAssessment, answers }).success).toBe(false);
  });

  it("rejects unexpected question IDs", () => {
    expect(AssessmentSchema.safeParse({
      ...validAssessment,
      answers: { ...validAssessment.answers, "50": 3 },
    }).success).toBe(false);
  });

  it.each([0, 1.5, 6, Number.POSITIVE_INFINITY])("rejects an invalid Likert value: %s", (value) => {
    expect(AssessmentSchema.safeParse({
      ...validAssessment,
      answers: { ...validAssessment.answers, "1": value },
    }).success).toBe(false);
  });

  it("rejects client-controlled source labels and unknown fields", () => {
    expect(AssessmentSchema.safeParse({ ...validAssessment, source: "forged-campaign" }).success).toBe(false);
    expect(AssessmentSchema.safeParse({ ...validAssessment, isAdmin: true }).success).toBe(false);
  });
});
