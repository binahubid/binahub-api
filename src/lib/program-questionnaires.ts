export type QuestionnaireQuestion = {
  id: string;
  position: number;
  question_type: string;
  prompt: string;
  required: boolean;
  options: unknown;
  correct_answer: unknown;
  points: number | string;
  scale_min: number | null;
  scale_max: number | null;
};

export type QuestionnaireAnswer = {
  questionId: string;
  value: unknown;
};

export type QuestionnaireSubmission = {
  answers: unknown;
  percentage: number | string | null;
  submitted_at?: string;
};

function normalizedScalar(value: unknown) {
  if (typeof value === "string") return value.trim().toLocaleLowerCase("id-ID");
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function normalizedArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizedScalar).filter(Boolean).sort();
}

function valuesMatch(actual: unknown, expected: unknown, questionType?: string) {
  if (questionType === "number") {
    const left = Number(actual);
    const right = Number(expected);
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
  }
  if (Array.isArray(expected)) {
    const left = normalizedArray(actual);
    const right = normalizedArray(expected);
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return normalizedScalar(actual) === normalizedScalar(expected);
}

export type AnswerEvaluation = {
  questionId: string;
  scored: boolean;
  correct: boolean | null;
  awardedPoints: number;
  maximumPoints: number;
};

export function evaluateQuestionAnswer(question: QuestionnaireQuestion, actual: unknown): AnswerEvaluation {
  const points = Math.max(0, Number(question.points || 0));
  const expected = question.correct_answer;
  if (question.question_type === "short_text" || question.question_type === "long_text") {
    return { questionId: question.id, scored: false, correct: null, awardedPoints: 0, maximumPoints: 0 };
  }
  if (expected === null || expected === undefined || points === 0) {
    return { questionId: question.id, scored: false, correct: null, awardedPoints: 0, maximumPoints: 0 };
  }

  if (question.question_type === "multiple_choice" && Array.isArray(expected)) {
    const selected = new Set(normalizedArray(actual));
    const correctOptions = new Set(normalizedArray(expected));
    if (correctOptions.size === 0) {
      return { questionId: question.id, scored: false, correct: null, awardedPoints: 0, maximumPoints: 0 };
    }
    const correctSelected = [...selected].filter((value) => correctOptions.has(value)).length;
    const wrongSelected = [...selected].filter((value) => !correctOptions.has(value)).length;
    const ratio = Math.max(0, (correctSelected - wrongSelected) / correctOptions.size);
    const awardedPoints = Number((points * ratio).toFixed(2));
    const correct = selected.size === correctOptions.size && [...selected].every((value) => correctOptions.has(value));
    return { questionId: question.id, scored: true, correct, awardedPoints, maximumPoints: points };
  }

  const correct = valuesMatch(actual, expected, question.question_type);
  return { questionId: question.id, scored: true, correct, awardedPoints: correct ? points : 0, maximumPoints: points };
}

export function scoreQuestionnaire(
  questions: QuestionnaireQuestion[],
  answers: QuestionnaireAnswer[],
) {
  const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  let score = 0;
  let maximumScore = 0;

  for (const question of questions) {
    const evaluation = evaluateQuestionAnswer(question, answerMap.get(question.id));
    maximumScore += evaluation.maximumPoints;
    score += evaluation.awardedPoints;
  }

  const percentage = maximumScore > 0 ? Number(((score / maximumScore) * 100).toFixed(2)) : null;
  const evaluations = questions.map((question) => evaluateQuestionAnswer(question, answerMap.get(question.id)));
  return { score: Number(score.toFixed(2)), maximumScore, percentage, evaluations };
}

function answerArray(value: unknown): QuestionnaireAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is QuestionnaireAnswer => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Record<string, unknown>;
    return typeof candidate.questionId === "string" && "value" in candidate;
  });
}

function isAnswered(value: unknown) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export function summarizeQuestionnaire(
  questions: QuestionnaireQuestion[],
  submissions: QuestionnaireSubmission[],
) {
  const percentages = submissions
    .map((submission) => submission.percentage === null ? null : Number(submission.percentage))
    .filter((value): value is number => value !== null && Number.isFinite(value));

  const overall = {
    submissionCount: submissions.length,
    scoredSubmissionCount: percentages.length,
    averagePercentage: percentages.length
      ? Number((percentages.reduce((total, value) => total + value, 0) / percentages.length).toFixed(2))
      : null,
    minimumPercentage: percentages.length ? Math.min(...percentages) : null,
    maximumPercentage: percentages.length ? Math.max(...percentages) : null,
    distribution: [
      { label: "0–20", count: percentages.filter((value) => value < 20).length },
      { label: "20–40", count: percentages.filter((value) => value >= 20 && value < 40).length },
      { label: "40–60", count: percentages.filter((value) => value >= 40 && value < 60).length },
      { label: "60–80", count: percentages.filter((value) => value >= 60 && value < 80).length },
      { label: "80–100", count: percentages.filter((value) => value >= 80).length },
    ],
  };

  const perQuestion = questions.map((question) => {
    const values = submissions
      .map((submission) => {
        const found = answerArray(submission.answers).find((answer) => answer.questionId === question.id);
        return found?.value;
      })
      .filter(isAnswered);

    const optionCounts = new Map<string, number>();
    const numericValues: number[] = [];
    for (const value of values) {
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) {
        const label = typeof entry === "string" ? entry.trim() : String(entry);
        if (label) optionCounts.set(label, (optionCounts.get(label) || 0) + 1);
      }
      const numeric = Number(value);
      if (!Array.isArray(value) && Number.isFinite(numeric)) numericValues.push(numeric);
    }

    return {
      questionId: question.id,
      position: question.position,
      prompt: question.prompt,
      questionType: question.question_type,
      responseCount: values.length,
      unansweredCount: submissions.length - values.length,
      responseRatePercent: submissions.length
        ? Number(((values.length / submissions.length) * 100).toFixed(2))
        : 0,
      optionCounts: Array.from(optionCounts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "id-ID")),
      numericSummary: numericValues.length ? {
        average: Number((numericValues.reduce((total, value) => total + value, 0) / numericValues.length).toFixed(2)),
        minimum: Math.min(...numericValues),
        maximum: Math.max(...numericValues),
      } : null,
    };
  });

  return { overall, perQuestion };
}
