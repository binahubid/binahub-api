import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { programQuestionnaireMutationSchema } from "@/lib/configurable-business-schemas";
import { evaluateQuestionAnswer, summarizeQuestionnaire, type QuestionnaireQuestion } from "@/lib/program-questionnaires";
import { createServerSupabase } from "@/lib/supabase";

const uuidSchema = z.string().uuid();

function questionPayload(question: {
  position: number;
  questionType: string;
  prompt: string;
  helpText: string;
  required: boolean;
  options: string[];
  correctAnswer?: string | number | boolean | string[] | null;
  points: number;
  scaleMin?: number | null;
  scaleMax?: number | null;
  scaleLabels: Record<string, string>;
}) {
  return {
    position: question.position,
    question_type: question.questionType,
    prompt: question.prompt,
    help_text: question.helpText,
    required: question.required,
    options: question.options,
    correct_answer: question.correctAnswer ?? null,
    points: question.points,
    scale_min: question.scaleMin ?? null,
    scale_max: question.scaleMax ?? null,
    scale_labels: question.scaleLabels,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !uuidSchema.safeParse(programId).success) {
    return adminError("programId tidak valid.", 400, "INVALID_PROGRAM_ID");
  }

  const db = createServerSupabase();
  const { data: program, error: programError } = await db
    .from("engagements")
    .select("id, code, title, status")
    .eq("id", programId)
    .maybeSingle();
  if (programError) return adminError(programError.message, 500, "PROGRAM_LOAD_FAILED");
  if (!program) return adminError("Program tidak ditemukan.", 404, "PROGRAM_NOT_FOUND");

  const { data: questionnaires, error: questionnaireError } = await db
    .from("program_questionnaires")
    .select("*")
    .eq("program_id", programId)
    .order("kind");
  if (questionnaireError) return adminError(questionnaireError.message, 500, "QUESTIONNAIRE_LOAD_FAILED");

  const questionnaireIds = (questionnaires || []).map((item) => item.id);
  if (questionnaireIds.length === 0) {
    return NextResponse.json({ success: true, program, questionnaires: [] });
  }

  const [
    { data: questions, error: questionError },
    { data: submissions, error: submissionError },
  ] = await Promise.all([
    db.from("program_questionnaire_questions")
      .select("*")
      .in("questionnaire_id", questionnaireIds)
      .order("position"),
    db.from("program_questionnaire_submissions")
      .select("id, questionnaire_id, profile_id, participant_id, answers, score, maximum_score, percentage, attempt_number, submitted_at, participant:participants(name, email)")
      .in("questionnaire_id", questionnaireIds)
      .order("submitted_at", { ascending: false }),
  ]);
  const loadError = questionError || submissionError;
  if (loadError) return adminError(loadError.message, 500, "QUESTIONNAIRE_DETAIL_LOAD_FAILED");

  return NextResponse.json({
    success: true,
    program,
    questionnaires: (questionnaires || []).map((questionnaire) => {
      const questionnaireQuestions = (questions || []).filter((item) => item.questionnaire_id === questionnaire.id);
      const questionnaireSubmissions = (submissions || []).filter((item) => item.questionnaire_id === questionnaire.id);
      return {
        ...questionnaire,
        questions: questionnaireQuestions,
        submissions: questionnaireSubmissions.map((submission) => {
          const answerMap = new Map((Array.isArray(submission.answers) ? submission.answers : []).flatMap((item) => {
            if (!item || typeof item !== "object") return [];
            const candidate = item as { questionId?: unknown; value?: unknown };
            return typeof candidate.questionId === "string" ? [[candidate.questionId, candidate.value] as const] : [];
          }));
          return {
            ...submission,
            evaluations: questionnaireQuestions.map((question) => evaluateQuestionAnswer(question as QuestionnaireQuestion, answerMap.get(question.id))),
          };
        }),
        statistics: summarizeQuestionnaire(
          questionnaireQuestions as QuestionnaireQuestion[],
          questionnaireSubmissions,
        ),
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, programQuestionnaireMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_QUESTIONNAIRE_MUTATION");
  const input = parsed.data;
  const db = createServerSupabase();

  if (input.action === "save_questionnaire") {
    const { data: program, error: programError } = await db.from("engagements").select("id").eq("id", input.programId).maybeSingle();
    if (programError) return adminError(programError.message, 500, "PROGRAM_LOAD_FAILED");
    if (!program) return adminError("Program tidak ditemukan.", 404, "PROGRAM_NOT_FOUND");

    const payload = {
      program_id: input.programId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      instructions: input.instructions,
      passing_score: input.passingScore ?? null,
      allow_retake: input.allowRetake,
      shuffle_questions: input.shuffleQuestions,
      updated_by: admin.email,
      ...(!input.id ? { created_by: admin.email } : {}),
    };
    const query = input.id
      ? db.from("program_questionnaires").update(payload).eq("id", input.id).select().single()
      : db.from("program_questionnaires").upsert(payload, { onConflict: "program_id,kind" }).select().single();
    const { data, error } = await query;
    if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "QUESTIONNAIRE_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: "program_questionnaire_saved",
      targetType: "program_questionnaire",
      targetId: data.id,
      actor: admin.email,
      payload: { programId: input.programId, kind: input.kind },
      status: "Saved",
      message: `${input.kind === "pre_test" ? "Pre-test" : input.kind === "post_test" ? "Post-test" : "BinaInsight Program"} disimpan oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, questionnaire: data });
  }

  if (input.action === "save_question") {
    const { data: questionnaire } = await db.from("program_questionnaires").select("id, status, version").eq("id", input.questionnaireId).maybeSingle();
    if (!questionnaire) return adminError("Questionnaire tidak ditemukan.", 404, "QUESTIONNAIRE_NOT_FOUND");
    const { count: submissionCount } = await db.from("program_questionnaire_submissions").select("id", { count: "exact", head: true }).eq("questionnaire_id", input.questionnaireId);
    if ((submissionCount || 0) > 0) return adminError("Pertanyaan tidak dapat diubah setelah ada jawaban peserta.", 409, "QUESTIONNAIRE_HAS_SUBMISSIONS");
    const payload = {
      questionnaire_id: input.questionnaireId,
      ...questionPayload(input.question),
      updated_by: admin.email,
      ...(!input.question.id ? { created_by: admin.email } : {}),
    };
    const query = input.question.id
      ? db.from("program_questionnaire_questions").update(payload).eq("id", input.question.id).eq("questionnaire_id", input.questionnaireId).select().single()
      : db.from("program_questionnaire_questions").insert(payload).select().single();
    const { data, error } = await query;
    if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "QUESTION_SAVE_FAILED");
    await db.from("program_questionnaires").update({
      status: "draft",
      published_at: null,
      version: Number(questionnaire.version || 0) + 1,
      updated_by: admin.email,
    }).eq("id", input.questionnaireId);
    return NextResponse.json({ success: true, question: data });
  }

  if (input.action === "replace_questions") {
    const { data: questionnaire } = await db.from("program_questionnaires").select("id, status").eq("id", input.questionnaireId).maybeSingle();
    if (!questionnaire) return adminError("Questionnaire tidak ditemukan.", 404, "QUESTIONNAIRE_NOT_FOUND");
    const { count: submissionCount, error: countError } = await db
      .from("program_questionnaire_submissions")
      .select("id", { count: "exact", head: true })
      .eq("questionnaire_id", input.questionnaireId);
    if (countError) return adminError(countError.message, 500, "SUBMISSION_COUNT_FAILED");
    if ((submissionCount || 0) > 0) {
      return adminError("Soal tidak dapat diganti setelah memiliki jawaban peserta karena hasil lama harus tetap dapat diaudit.", 409, "QUESTIONNAIRE_HAS_SUBMISSIONS");
    }

    const { data, error } = await db.rpc("replace_program_questionnaire_questions", {
      p_questionnaire_id: input.questionnaireId,
      p_questions: input.questions,
      p_source_filename: input.sourceFilename || null,
      p_source_type: input.sourceType || null,
      p_actor: admin.email,
    });
    if (error) return adminError(error.message, 500, "QUESTION_IMPORT_FAILED");
    return NextResponse.json({ success: true, questions: data || [] });
  }

  if (input.action === "delete_question") {
    const { data: question } = await db.from("program_questionnaire_questions").select("id, questionnaire_id").eq("id", input.questionId).maybeSingle();
    if (!question) return adminError("Pertanyaan tidak ditemukan.", 404, "QUESTION_NOT_FOUND");
    const { count } = await db.from("program_questionnaire_submissions").select("id", { count: "exact", head: true }).eq("questionnaire_id", question.questionnaire_id);
    if ((count || 0) > 0) return adminError("Pertanyaan tidak dapat dihapus setelah ada jawaban peserta.", 409, "QUESTIONNAIRE_HAS_SUBMISSIONS");
    const { error } = await db.from("program_questionnaire_questions").delete().eq("id", input.questionId);
    if (error) return adminError(error.message, 500, "QUESTION_DELETE_FAILED");
    const { data: questionnaire } = await db.from("program_questionnaires").select("version").eq("id", question.questionnaire_id).maybeSingle();
    await db.from("program_questionnaires").update({
      status: "draft",
      published_at: null,
      version: Number(questionnaire?.version || 0) + 1,
      updated_by: admin.email,
    }).eq("id", question.questionnaire_id);
    return NextResponse.json({ success: true });
  }

  if (input.action === "set_status") {
    const { data: questionnaire } = await db.from("program_questionnaires").select("id").eq("id", input.questionnaireId).maybeSingle();
    if (!questionnaire) return adminError("Questionnaire tidak ditemukan.", 404, "QUESTIONNAIRE_NOT_FOUND");
    if (input.status === "published") {
      const { count, error: countError } = await db.from("program_questionnaire_questions").select("id", { count: "exact", head: true }).eq("questionnaire_id", input.questionnaireId);
      if (countError) return adminError(countError.message, 500, "QUESTION_COUNT_FAILED");
      if (!count) return adminError("Tambahkan minimal satu pertanyaan sebelum dipublikasikan.", 409, "QUESTIONNAIRE_EMPTY");
    }
    const { data, error } = await db.from("program_questionnaires").update({
      status: input.status,
      published_at: input.status === "published" ? new Date().toISOString() : null,
      updated_by: admin.email,
    }).eq("id", input.questionnaireId).select().single();
    if (error) return adminError(error.message, 500, "QUESTIONNAIRE_STATUS_FAILED");
    await logAdminEvent(db, {
      eventType: "program_questionnaire_status_changed",
      targetType: "program_questionnaire",
      targetId: input.questionnaireId,
      actor: admin.email,
      payload: { status: input.status },
      status: "Saved",
      message: `Status questionnaire diubah menjadi ${input.status} oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, questionnaire: data });
  }

  const { count } = await db.from("program_questionnaire_submissions").select("id", { count: "exact", head: true }).eq("questionnaire_id", input.questionnaireId);
  if ((count || 0) > 0) {
    const { data, error } = await db.from("program_questionnaires").update({ status: "archived", updated_by: admin.email }).eq("id", input.questionnaireId).select().single();
    if (error) return adminError(error.message, 500, "QUESTIONNAIRE_ARCHIVE_FAILED");
    return NextResponse.json({ success: true, archived: true, questionnaire: data });
  }
  const { error } = await db.from("program_questionnaires").delete().eq("id", input.questionnaireId);
  if (error) return adminError(error.message, 500, "QUESTIONNAIRE_DELETE_FAILED");
  return NextResponse.json({ success: true, deleted: true });
}
