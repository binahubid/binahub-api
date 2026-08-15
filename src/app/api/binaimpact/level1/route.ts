import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireTransformationActor } from "@/lib/transformation/auth";

const PayloadSchema = z.object({
  participantName: z.string().trim().min(1).max(200),
  organizationName: z.string().trim().min(1).max(200),
  assessmentDate: z.string().date(),
  email: z.string().trim().email().max(320),
  ratings: z.array(z.number().int().min(1).max(4)).length(5),
  mostImportantLearning: z.string().trim().min(1).max(4000),
  mostInterestingPart: z.string().trim().min(1).max(4000),
  generalFeedback: z.string().trim().max(4000).optional(),
});

export async function POST(req: NextRequest) {
  const rateLimited = await enforceRateLimit(req, "binaimpact-level1", 20, 60 * 60);
  if (rateLimited) return rateLimited;
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  if (actor.role !== "client" && actor.role !== "admin") {
    return NextResponse.json({ success: false, error: "Akses client tidak valid." }, { status: 403 });
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
      client_access_id: actor.accessCodeId || null,
      company_name: actor.companyName || null,
      team_name: actor.teamName || null,
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
