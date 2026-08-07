import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  // Only admins can see full dashboard
  if (auth.role !== "admin") {
    return NextResponse.json(
      { success: false, error: "Akses dashboard hanya untuk admin." },
      { status: 403 }
    );
  }

  const db = createServerSupabase();

  // Debug: check if service role key is loaded
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("[T-BOS Dashboard] SUPABASE_SERVICE_ROLE_KEY is not set!");
    return NextResponse.json(
      { success: false, error: "Server configuration error: missing service role key." },
      { status: 500 }
    );
  }

  // Fetch all teams
  const { data: teams, error: teamsError } = await db
    .from("tbos_teams")
    .select("id, name, batch")
    .order("batch", { ascending: true })
    .order("name", { ascending: true });

  if (teamsError) {
    console.error("[T-BOS Dashboard] teams query error:", JSON.stringify(teamsError));
    return NextResponse.json({ success: false, error: teamsError.message, code: teamsError.code, hint: teamsError.hint }, { status: 500 });
  }

  // Fetch all observations with scores
  const { data: observations, error: obsError } = await db
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
      tbos_missions (
        code,
        name
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
    .in("status", ["submitted", "locked"])
    .order("submitted_at", { ascending: false });

  if (obsError) {
    return NextResponse.json({ success: false, error: obsError.message }, { status: 500 });
  }

  // Transform observations to match frontend types
  const transformedObservations = (observations || []).map((obs: any) => ({
    id: obs.id,
    teamId: obs.team_id,
    teamName: teams?.find((t: any) => t.id === obs.team_id)?.name || "-",
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "-",
    profileId: obs.profile_id,
    facilitatorName: "",
    batch: obs.batch,
    observedAt: obs.observed_at,
    submittedAt: obs.submitted_at,
    status: obs.status,
    notes: obs.notes,
    scores: (obs.tbos_observation_scores || []).map((s: any) => ({
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
      levelLabel: ["", "Reactive", "Emerging", "Functional", "Effective", "Exemplary"][s.level_value] || "",
    })),
  }));

  // Fetch all dimensions for reference
  const { data: dimensions } = await db
    .from("tbos_behavioral_dimensions")
    .select("code, name, order_index")
    .order("order_index", { ascending: true });

  // Fetch all missions for reference
  const { data: missions } = await db
    .from("tbos_missions")
    .select("code, name");

  // Fetch mission-dimension mapping
  const { data: missionDims } = await db
    .from("tbos_mission_dimensions")
    .select(`
      mission_id,
      dimension_id,
      tbos_missions (code),
      tbos_behavioral_dimensions (code)
    `);

  const missionDimensionMap: Record<string, string[]> = {};
  for (const md of missionDims || []) {
    const mCode = (md as any).tbos_missions?.code;
    const dCode = (md as any).tbos_behavioral_dimensions?.code;
    if (mCode && dCode) {
      if (!missionDimensionMap[mCode]) missionDimensionMap[mCode] = [];
      missionDimensionMap[mCode].push(dCode);
    }
  }

  return NextResponse.json({
    success: true,
    teams: teams || [],
    observations: transformedObservations,
    dimensions: dimensions || [],
    missions: missions || [],
    missionDimensionMap,
    generatedAt: new Date().toISOString(),
  });
}
