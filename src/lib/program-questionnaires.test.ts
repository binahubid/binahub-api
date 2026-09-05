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
    ])).toMatchObject({ score: 2, maximumScore: 2, percentage: 100 });
  });

  it("awards fair partial credit for multiple-choice without negative scores", () => {
    const multiple: QuestionnaireQuestion = { ...questions[0], id: "multi", question_type: "multiple_choice", options: ["A", "B", "C", "D"], correct_answer: ["A", "B"], points: 4 };
    expect(scoreQuestionnaire([multiple], [{ questionId: "multi", value: ["A"] }])).toMatchObject({ score: 2, maximumScore: 4, percentage: 50 });
    expect(scoreQuestionnaire([multiple], [{ questionId: "multi", value: ["A", "C"] }])).toMatchObject({ score: 0, maximumScore: 4, percentage: 0 });
  });

  it("compares numeric equivalents and excludes open text from automatic grading", () => {
    const number: QuestionnaireQuestion = { ...questions[0], id: "number", question_type: "number", correct_answer: 2, points: 3 };
    const open: QuestionnaireQuestion = { ...questions[0], id: "open", question_type: "short_text", correct_answer: "jawaban", points: 10 };
    expect(scoreQuestionnaire([number, open], [{ questionId: "number", value: "2.0" }, { questionId: "open", value: "jawaban" }])).toMatchObject({ score: 3, maximumScore: 3, percentage: 100 });
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
