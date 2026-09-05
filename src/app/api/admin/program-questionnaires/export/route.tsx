import { renderToBuffer } from "@react-pdf/renderer";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { evaluateQuestionAnswer, type QuestionnaireQuestion } from "@/lib/program-questionnaires";
import { ProgramQuestionnaireReportDocument } from "@/lib/program-questionnaire-report-document";
import { createServerSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  const questionnaireId = req.nextUrl.searchParams.get("questionnaireId");
  if (!z.string().uuid().safeParse(questionnaireId).success) {
    return NextResponse.json({ success: false, error: "questionnaireId tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data: questionnaire, error } = await db.from("program_questionnaires")
    .select("id, program_id, title, kind, passing_score, program:engagements(code, title)")
    .eq("id", questionnaireId!).maybeSingle();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!questionnaire) return NextResponse.json({ success: false, error: "Form tidak ditemukan." }, { status: 404 });

  const [{ data: questions, error: questionError }, { data: submissions, error: submissionError }] = await Promise.all([
    db.from("program_questionnaire_questions").select("*").eq("questionnaire_id", questionnaire.id).order("position"),
    db.from("program_questionnaire_submissions")
      .select("id, answers, score, maximum_score, percentage, attempt_number, submitted_at, participant:participants(name, email)")
      .eq("questionnaire_id", questionnaire.id).order("submitted_at", { ascending: false }),
  ]);
  if (questionError || submissionError) return NextResponse.json({ success: false, error: (questionError || submissionError)?.message }, { status: 500 });
  const reportQuestions = (questions || []) as QuestionnaireQuestion[];
  const normalizedSubmissions = (submissions || []).map((submission) => {
    const participant = Array.isArray(submission.participant) ? submission.participant[0] : submission.participant;
    const answers = Array.isArray(submission.answers) ? submission.answers.filter((item): item is { questionId: string; value: unknown } => Boolean(item && typeof item === "object" && typeof (item as { questionId?: unknown }).questionId === "string")) : [];
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.value]));
    return {
      id: submission.id,
      participantName: participant?.name || "Peserta tanpa nama",
      participantEmail: participant?.email || null,
      attemptNumber: submission.attempt_number,
      submittedAt: submission.submitted_at,
      score: submission.score === null ? null : Number(submission.score),
      maximumScore: submission.maximum_score === null ? null : Number(submission.maximum_score),
      percentage: submission.percentage === null ? null : Number(submission.percentage),
      answers,
      evaluations: reportQuestions.map((question) => evaluateQuestionAnswer(question, answerMap.get(question.id))),
    };
  });
  const program = Array.isArray(questionnaire.program) ? questionnaire.program[0] : questionnaire.program;
  const buffer = await renderToBuffer(<ProgramQuestionnaireReportDocument
    program={{ code: program?.code || null, title: program?.title || "Program" }}
    questionnaire={questionnaire}
    questions={reportQuestions}
    submissions={normalizedSubmissions}
  />);
  const filename = `binahub-${questionnaire.kind}-${(program?.code || "program").replace(/[^a-zA-Z0-9_-]+/g, "_")}.pdf`;
  return new NextResponse(new Uint8Array(buffer), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  } });
}
