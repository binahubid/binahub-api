import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { questionnaireSubmissionSchema } from "@/lib/configurable-business-schemas";
import { scoreQuestionnaire, type QuestionnaireQuestion } from "@/lib/program-questionnaires";
import { createServerSupabase } from "@/lib/supabase";

const kindSchema = z.enum(["pre_test", "post_test"]);

async function questionnaireAvailable(
  db: ReturnType<typeof createServerSupabase>,
  programId: string,
  questionnaireId?: string,
  kind?: "pre_test" | "post_test",
) {
  let query = db.from("program_questionnaires").select("*")
    .eq("program_id", programId)
    .eq("status", "published");
  if (questionnaireId) query = query.eq("id", questionnaireId);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.maybeSingle();
  return { questionnaire: data, error };
}

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  if (actor.role !== "client" || !actor.programId || !actor.userId) {
    return NextResponse.json({ success: false, error: "Sesi ini tidak terikat ke peserta program." }, { status: 403 });
  }

  const parsedKind = kindSchema.safeParse(req.nextUrl.searchParams.get("kind"));
  if (!parsedKind.success) return NextResponse.json({ success: false, error: "Jenis test tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  const { data: module } = await db.from("program_modules").select("enabled")
    .eq("program_id", actor.programId).eq("module_key", parsedKind.data).maybeSingle();
  if (!module?.enabled) return NextResponse.json({ success: false, error: "Modul ini belum diaktifkan untuk program." }, { status: 403 });

  const { questionnaire, error } = await questionnaireAvailable(db, actor.programId, undefined, parsedKind.data);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  if (!questionnaire) return NextResponse.json({ success: false, error: "Test belum dipublikasikan." }, { status: 404 });

  const [
    { data: questions, error: questionError },
    { data: submissions, error: submissionError },
  ] = await Promise.all([
    db.from("program_questionnaire_questions")
      .select("id, position, question_type, prompt, help_text, required, options, points, scale_min, scale_max, scale_labels")
      .eq("questionnaire_id", questionnaire.id)
      .order("position"),
    db.from("program_questionnaire_submissions")
      .select("id, score, maximum_score, percentage, attempt_number, submitted_at")
      .eq("questionnaire_id", questionnaire.id)
      .eq("profile_id", actor.userId)
      .order("attempt_number", { ascending: false }),
  ]);
  const loadError = questionError || submissionError;
  if (loadError) return NextResponse.json({ success: false, error: loadError.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    questionnaire: {
      id: questionnaire.id,
      kind: questionnaire.kind,
      title: questionnaire.title,
      description: questionnaire.description,
      instructions: questionnaire.instructions,
      passingScore: questionnaire.passing_score,
      allowRetake: questionnaire.allow_retake,
      shuffleQuestions: questionnaire.shuffle_questions,
      questions: questions || [],
    },
    submissions: submissions || [],
    canSubmit: questionnaire.allow_retake || (submissions || []).length === 0,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  if (actor.role !== "client" || !actor.programId || !actor.userId) {
    return NextResponse.json({ success: false, error: "Sesi ini tidak terikat ke peserta program." }, { status: 403 });
  }
  const parsed = questionnaireSubmissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Jawaban tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  const { questionnaire, error: questionnaireError } = await questionnaireAvailable(db, actor.programId, parsed.data.questionnaireId);
  if (questionnaireError) return NextResponse.json({ success: false, error: questionnaireError.message }, { status: 500 });
  if (!questionnaire) return NextResponse.json({ success: false, error: "Test tidak tersedia." }, { status: 404 });

  const { data: module } = await db.from("program_modules").select("enabled")
    .eq("program_id", actor.programId).eq("module_key", questionnaire.kind).maybeSingle();
  if (!module?.enabled) return NextResponse.json({ success: false, error: "Modul test tidak aktif." }, { status: 403 });

  const { data: questions, error: questionError } = await db.from("program_questionnaire_questions").select("*")
    .eq("questionnaire_id", questionnaire.id).order("position");
  if (questionError) return NextResponse.json({ success: false, error: questionError.message }, { status: 500 });
  if (!questions?.length) return NextResponse.json({ success: false, error: "Test belum memiliki pertanyaan." }, { status: 409 });

  const questionIds = new Set(questions.map((question) => question.id));
  if (parsed.data.answers.some((answer) => !questionIds.has(answer.questionId))) {
    return NextResponse.json({ success: false, error: "Jawaban memuat pertanyaan yang tidak dikenali." }, { status: 400 });
  }
  const answerMap = new Map(parsed.data.answers.map((answer) => [answer.questionId, answer.value]));
  const missingRequired = questions.find((question) => {
    if (!question.required) return false;
    const value = answerMap.get(question.id);
    return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  });
  if (missingRequired) return NextResponse.json({ success: false, error: `Pertanyaan wajib belum dijawab: ${missingRequired.prompt}` }, { status: 400 });

  const { data: previous, error: previousError } = await db.from("program_questionnaire_submissions")
    .select("id, attempt_number")
    .eq("questionnaire_id", questionnaire.id)
    .eq("profile_id", actor.userId)
    .order("attempt_number", { ascending: false });
  if (previousError) return NextResponse.json({ success: false, error: previousError.message }, { status: 500 });
  if (!questionnaire.allow_retake && previous?.length) {
    return NextResponse.json({ success: false, error: "Test ini hanya dapat dikirim satu kali." }, { status: 409 });
  }

  const scoring = scoreQuestionnaire(questions as QuestionnaireQuestion[], parsed.data.answers);
  const attemptNumber = Number(previous?.[0]?.attempt_number || 0) + 1;
  const { data, error } = await db.from("program_questionnaire_submissions").insert({
    questionnaire_id: questionnaire.id,
    program_id: actor.programId,
    profile_id: actor.userId,
    participant_id: actor.participantId || null,
    answers: parsed.data.answers,
    score: scoring.score,
    maximum_score: scoring.maximumScore,
    percentage: scoring.percentage,
    attempt_number: attemptNumber,
    submitted_by: actor.email,
  }).select("id, score, maximum_score, percentage, attempt_number, submitted_at").single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: error.code === "23505" ? 409 : 500 });

  return NextResponse.json({ success: true, submission: data });
}
