import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const observationSchema = z.object({
  teamId: z.string().uuid(),
  missionId: z.string().uuid(),
  clientSubmissionId: z.string().min(1).max(128),
  batch: z.enum(["Batch 1", "Batch 2"]),
  notes: z.string().max(50).optional().default(""),
  scores: z.array(
    z.object({
      dimensionId: z.string().uuid(),
      levelValue: z.number().int().min(1).max(5),
    })
  ).min(1),
});

export async function POST(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const parsed = observationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { teamId, missionId, clientSubmissionId, notes, scores } = parsed.data;
  const db = createServerSupabase();

  const [{ data: team }, { data: assignment }, { data: missionDimensions }] = await Promise.all([
    db.from("tbos_teams").select("id, batch").eq("id", teamId).maybeSingle(),
    db.from("tbos_facilitator_teams").select("team_id").eq("profile_id", auth.userId).eq("team_id", teamId).maybeSingle(),
    db.from("tbos_mission_dimensions").select("dimension_id").eq("mission_id", missionId),
  ]);

  if (!team) {
    return NextResponse.json({ success: false, error: "Tim tidak ditemukan." }, { status: 404 });
  }
  if (auth.role !== "admin" && !assignment) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }

  const requiredDimensionIds = new Set((missionDimensions || []).map((row: any) => row.dimension_id));
  const submittedDimensionIds = scores.map((score) => score.dimensionId);
  if (
    requiredDimensionIds.size === 0 ||
    submittedDimensionIds.length !== requiredDimensionIds.size ||
    new Set(submittedDimensionIds).size !== submittedDimensionIds.length ||
    submittedDimensionIds.some((id) => !requiredDimensionIds.has(id))
  ) {
    return NextResponse.json({ success: false, error: "Nilai dimensi tidak sesuai dengan misi yang dipilih." }, { status: 400 });
  }

  const { data: observationId, error } = await db.rpc("tbos_submit_observation", {
    p_facilitator_id: auth.userId,
    p_team_id: teamId,
    p_mission_id: missionId,
    p_client_submission_id: clientSubmissionId,
    p_notes: notes || null,
    p_scores: scores,
    p_is_admin: auth.role === "admin",
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23503" ? 404 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }

  return NextResponse.json({ success: true, observationId });
}

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const url = new URL(req.url);
  const teamId = url.searchParams.get("teamId");
  const missionId = url.searchParams.get("missionId");

  let query = db
    .from("tbos_observations")
    .select(`
      id,
      team_id,
      mission_id,
      profile_id,
      batch,
      observed_at,
      submitted_at,
      status,
      notes,
      locked_at,
      locked_by,
      revision_deadline,
      tbos_teams (
        name
      ),
      tbos_missions (
        code,
        name
      ),
      profiles (
        full_name
      ),
      tbos_observation_scores (
        dimension_id,
        level_value,
        tbos_behavioral_dimensions (
          code,
          name
        )
      )
    `)
    .order("submitted_at", { ascending: false });

  // Facilitators see only their own observations; admins see all
  if (auth.role !== "admin") {
    query = query.eq("profile_id", auth.userId);
  }

  if (teamId) {
    query = query.eq("team_id", teamId);
  }
  if (missionId) {
    query = query.eq("mission_id", missionId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const observations = (data || []).map((obs: any) => ({
    id: obs.id,
    teamId: obs.team_id,
    teamName: obs.tbos_teams?.name || "-",
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "-",
    profileId: obs.profile_id,
    facilitatorName: obs.profiles?.full_name || "-",
    batch: obs.batch,
    observedAt: obs.observed_at,
    submittedAt: obs.submitted_at,
    status: obs.status,
    notes: obs.notes,
    lockedAt: obs.locked_at,
    lockedBy: obs.locked_by,
    revisionDeadline: obs.revision_deadline,
    canEdit: obs.status === "submitted" && (!obs.revision_deadline || new Date(obs.revision_deadline).getTime() > Date.now()),
    scores: (obs.tbos_observation_scores || []).map((s: any) => ({
      dimensionId: s.dimension_id,
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
    })),
  }));

  return NextResponse.json({ success: true, observations });
}
