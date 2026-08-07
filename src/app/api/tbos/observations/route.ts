import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const observationSchema = z.object({
  teamId: z.string().uuid(),
  missionId: z.string().uuid(),
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

  // Only facilitators can submit observations (not admins)
  if (auth.role === "admin") {
    return NextResponse.json(
      { success: false, error: "Admin tidak dapat menginput observasi. Hanya fasilitator." },
      { status: 403 }
    );
  }

  const body = await req.json();
  const parsed = observationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { teamId, missionId, batch, notes, scores } = parsed.data;
  const db = createServerSupabase();

  // Verify facilitator is assigned to this mission
  const { data: fmCheck, error: fmError } = await db
    .from("tbos_facilitator_missions")
    .select("profile_id")
    .eq("profile_id", auth.userId)
    .eq("mission_id", missionId)
    .single();

  if (fmError || !fmCheck) {
    return NextResponse.json(
      { success: false, error: "Anda tidak ditugaskan untuk mission ini." },
      { status: 403 }
    );
  }

  // Verify mission-dimension mapping (only allowed dimensions can be scored)
  const { data: allowedDims } = await db
    .from("tbos_mission_dimensions")
    .select("dimension_id")
    .eq("mission_id", missionId);

  const allowedDimIds = new Set((allowedDims || []).map((d: any) => d.dimension_id));
  for (const score of scores) {
    if (!allowedDimIds.has(score.dimensionId)) {
      return NextResponse.json(
        { success: false, error: `Dimensi ${score.dimensionId} tidak relevan untuk mission ini.` },
        { status: 400 }
      );
    }
  }

  // Insert observation
  const { data: observation, error: obsError } = await db
    .from("tbos_observations")
    .insert({
      team_id: teamId,
      mission_id: missionId,
      profile_id: auth.userId,
      batch,
      status: "submitted",
      notes: notes || null,
    })
    .select()
    .single();

  if (obsError) {
    return NextResponse.json({ success: false, error: obsError.message }, { status: 500 });
  }

  // Insert observation scores
  const scoreRows = scores.map((s) => ({
    observation_id: observation.id,
    dimension_id: s.dimensionId,
    level_value: s.levelValue,
  }));

  const { error: scoresError } = await db
    .from("tbos_observation_scores")
    .insert(scoreRows);

  if (scoresError) {
    // Rollback observation
    await db.from("tbos_observations").delete().eq("id", observation.id);
    return NextResponse.json({ success: false, error: scoresError.message }, { status: 500 });
  }

  // Audit log: create + submit
  await db.from("tbos_observation_audit_log").insert([
    {
      observation_id: observation.id,
      actor_id: auth.userId,
      actor_role: "facilitator",
      action: "create",
      new_status: "submitted",
    },
  ]);

  return NextResponse.json({ success: true, observationId: observation.id });
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
