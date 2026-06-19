import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { getClientAccess } from "@/lib/client-access";

const PayloadSchema = z.object({
  participantName: z.string().min(1),
  organizationName: z.string().min(1),
  assessmentDate: z.string().min(1),
  email: z.string().email(),
  ratings: z.array(z.number().int().min(1).max(4)).length(5),
  mostImportantLearning: z.string().min(1),
  mostInterestingPart: z.string().min(1),
  generalFeedback: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const access = await getClientAccess();
  if (!access) {
    return NextResponse.json({ success: false, error: "Akses client tidak valid." }, { status: 401 });
  }

  const body = await req.json();
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Form evaluasi tidak valid." }, { status: 400 });
  }

  const payload = parsed.data;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("binaimpact_level1_evaluations")
    .insert({
      client_access_id: access.id,
      company_name: access.company_name,
      team_name: access.team_name,
      participant_name: payload.participantName,
      organization_name: payload.organizationName,
      assessment_date: payload.assessmentDate,
      email: payload.email,
      ratings: payload.ratings,
      most_important_learning: payload.mostImportantLearning,
      most_interesting_part: payload.mostInterestingPart,
      general_feedback: payload.generalFeedback || null,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, evaluation: data });
}
