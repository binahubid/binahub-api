import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { createServerSupabase } from "@/lib/supabase";
import { masmindoCriteria } from "@/lib/team-building";

const scoreKeys = masmindoCriteria.map((item) => item.key);

const ScoreSchema = z.object(
  Object.fromEntries(scoreKeys.map((key) => [key, z.number().int()])) as Record<
    (typeof scoreKeys)[number],
    z.ZodNumber
  >,
);

const PayloadSchema = z.object({
  companyName: z.string().min(1),
  teamName: z.string().min(1),
  gameName: z.string().min(1),
  sessionCount: z.number().int().min(1),
  sessionNumber: z.number().int().min(1).optional(),
  assessmentDate: z.string().min(1),
  facilitatorName: z.string().min(1),
  scores: ScoreSchema.optional(),
});

const UpdatePayloadSchema = z.object({
  id: z.string().uuid(),
  scores: ScoreSchema,
});

export async function POST(req: NextRequest) {
  const facilitator = await requireFacilitator(req);
  if ("error" in facilitator) {
    return NextResponse.json({ success: false, error: facilitator.error }, { status: facilitator.status });
  }

  const body = await req.json();
  const parsed = PayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload penilaian tidak valid." }, { status: 400 });
  }

  const payload = parsed.data;
  const scores = payload.scores || Object.fromEntries(scoreKeys.map((key) => [key, 0]));
  const totalScore = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const db = createServerSupabase();

  const { data, error } = await db
    .from("facilitator_team_scores")
    .insert({
      company_name: payload.companyName,
      team_name: payload.teamName,
      game_name: payload.gameName,
      session_count: payload.sessionCount,
      session_number: payload.sessionNumber || 1,
      assessment_date: payload.assessmentDate,
      facilitator_name: payload.facilitatorName,
      facilitator_email: facilitator.email,
      scores,
      total_score: totalScore,
    })
    .select("id, total_score")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, score: data });
}

export async function PATCH(req: NextRequest) {
  const facilitator = await requireFacilitator(req);
  if ("error" in facilitator) {
    return NextResponse.json({ success: false, error: facilitator.error }, { status: facilitator.status });
  }

  const body = await req.json();
  const parsed = UpdatePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Payload skor tidak valid." }, { status: 400 });
  }

  const payload = parsed.data;
  const totalScore = Object.values(payload.scores).reduce((sum, value) => sum + value, 0);
  const db = createServerSupabase();

  const { data, error } = await db
    .from("facilitator_team_scores")
    .update({
      scores: payload.scores,
      total_score: totalScore,
    })
    .eq("id", payload.id)
    .select("id, total_score")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, score: data });
}

export async function GET(req: NextRequest) {
  const facilitator = await requireFacilitator(req);
  if ("error" in facilitator) {
    return NextResponse.json({ success: false, error: facilitator.error }, { status: facilitator.status });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("facilitator_team_scores")
    .select("id, company_name, team_name, game_name, session_count, session_number, assessment_date, facilitator_name, facilitator_email, scores, total_score, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, scores: data });
}
