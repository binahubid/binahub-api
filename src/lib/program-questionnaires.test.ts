import { describe, expect, it } from "vitest";
import { scoreQuestionnaire, summarizeQuestionnaire, type QuestionnaireQuestion } from "./program-questionnaires";

const questions: QuestionnaireQuestion[] = [
  {
    id: "q1",
    position: 1,
    question_type: "single_choice",
    prompt: "Pilihan",
    required: true,
    options: ["A", "B"],
    correct_answer: "A",
    points: 2,
    scale_min: null,
    scale_max: null,
  },
  {
    id: "q2",
    position: 2,
    question_type: "scale",
    prompt: "Skala",
    required: true,
    options: [],
    correct_answer: null,
    points: 1,
    scale_min: 1,
    scale_max: 5,
  },
];

describe("program questionnaires", () => {
  it("scores only questions with an answer key", () => {
    expect(scoreQuestionnaire(questions, [
      { questionId: "q1", value: "A" },
      { questionId: "q2", value: 4 },
    ])).toEqual({ score: 2, maximumScore: 2, percentage: 100 });
  });

  it("builds overall and per-question statistics", () => {
    const summary = summarizeQuestionnaire(questions, [
      { percentage: 100, answers: [{ questionId: "q1", value: "A" }, { questionId: "q2", value: 4 }] },
      { percentage: 0, answers: [{ questionId: "q1", value: "B" }, { questionId: "q2", value: 2 }] },
    ]);
    expect(summary.overall).toMatchObject({
      submissionCount: 2,
      averagePercentage: 50,
      minimumPercentage: 0,
      maximumPercentage: 100,
    });
    expect(summary.perQuestion[1].numericSummary).toEqual({ average: 3, minimum: 2, maximum: 4 });
  });
});
