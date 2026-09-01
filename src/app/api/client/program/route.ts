import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createServerSupabase } from "@/lib/supabase";
import { programAccessAvailable } from "@/lib/client-program";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  if (actor.role !== "client" || !actor.programId || !actor.participantId) {
    return NextResponse.json({ success: false, error: "Sesi ini tidak terikat ke program." }, { status: 403 });
  }

  const db = createServerSupabase();
  const [
    { data: program, error: programError },
    { data: modules, error: moduleError },
    { data: lepResponse, error: lepResponseError },
    { data: insightAssessment, error: insightAssessmentError },
    { data: questionnaireSubmissions, error: questionnaireSubmissionError },
  ] = await Promise.all([
    db
      .from("engagements")
      .select("id, code, title, type, status, start_date, end_date, location, organization_id, organization:organizations(name)")
      .eq("id", actor.programId)
      .maybeSingle(),
    db
      .from("program_modules")
      .select("module_key, enabled")
      .eq("program_id", actor.programId)
      .eq("enabled", true)
      .order("module_key", { ascending: true }),
    db
      .from("lep_responses")
      .select("id")
      .eq("program_id", actor.programId)
      .eq("profile_id", actor.userId)
      .limit(1)
      .maybeSingle(),
    db
      .from("assessments")
      .select("id")
      .eq("program_id", actor.programId)
      .eq("participant_id", actor.participantId)
      .not("scores", "is", null)
      .limit(1)
      .maybeSingle(),
    db
      .from("program_questionnaire_submissions")
      .select("questionnaire:program_questionnaires(kind)")
      .eq("program_id", actor.programId)
      .eq("profile_id", actor.userId),
  ]);
  if (programError || !program) {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }
  if (moduleError) return NextResponse.json({ success: false, error: moduleError.message }, { status: 500 });
  if (lepResponseError) return NextResponse.json({ success: false, error: lepResponseError.message }, { status: 500 });
  if (insightAssessmentError) return NextResponse.json({ success: false, error: insightAssessmentError.message }, { status: 500 });
  if (questionnaireSubmissionError) return NextResponse.json({ success: false, error: questionnaireSubmissionError.message }, { status: 500 });
  if (!programAccessAvailable(program)) {
    return NextResponse.json({ success: false, error: "Program tidak sedang aktif." }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    program: {
      id: program.id,
      code: program.code,
      title: program.title,
      type: program.type,
      status: program.status,
      startDate: program.start_date,
      endDate: program.end_date,
      location: program.location,
      organizationId: program.organization_id,
      companyName: program.organization[0]?.name || "Perusahaan",
    },
    participant: { id: actor.participantId, name: actor.teamName || "Peserta" },
    modules: (modules || []).map((module) => {
      const completedTests = new Set((questionnaireSubmissions || []).map((submission) => {
        const linked = Array.isArray(submission.questionnaire) ? submission.questionnaire[0] : submission.questionnaire;
        return linked?.kind;
      }));
      return {
        key: module.module_key,
        enabled: module.enabled,
        clientAvailable: ["lep", "binainsight", "pre_test", "post_test"].includes(module.module_key),
        completed: module.module_key === "lep"
          ? Boolean(lepResponse)
          : module.module_key === "binainsight"
            ? Boolean(insightAssessment)
            : completedTests.has(module.module_key),
      };
    }),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
