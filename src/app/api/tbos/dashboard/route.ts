import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { z } from "zod";
import { collectAllPages } from "@/lib/pagination";

interface TeamRecord {
  id: string;
  name: string;
  batch: string;
  batch_id: string | null;
  organization_id: string | null;
  engagement_id: string | null;
  batches?: { id: string; name: string }[] | { id: string; name: string } | null;
}

interface ObservationRecord {
  id: string;
  team_id: string;
  mission_id: string;
  profile_id: string;
  batch: string;
  observed_at: string;
  submitted_at: string;
  status: string;
  notes: string | null;
  tbos_missions: { code: string; name: string } | null;
  profiles: { full_name: string } | null;
  tbos_observation_scores: Array<{
    dimension_id: string;
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | null;
  }>;
}

interface MissionDimensionRecord {
  tbos_missions: { code: string } | null;
  tbos_behavioral_dimensions: { code: string } | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }

  // Debug: check if service role key is loaded
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("[T-BOS Dashboard] SUPABASE_SERVICE_ROLE_KEY is not set!");
    return NextResponse.json(
      { success: false, error: "Server configuration error: missing service role key." },
      { status: 500 }
    );
  }

  try {
    if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
      return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  let teams: TeamRecord[] = [];
  let assignedMissionIds: string[] = [];

  if (auth.role !== "admin") {
    const { data: assignments, error: assignmentError } = await db
      .from("facilitator_missions")
      .select("mission_id")
      .eq("profile_id", auth.userId)
      .eq("program_id", programId);

    if (assignmentError) {
      console.error("[T-BOS Dashboard] assignment query error:", assignmentError);
      return NextResponse.json({ success: false, error: "Gagal memuat cakupan fasilitator." }, { status: 500 });
    }

    assignedMissionIds = [...new Set((assignments || []).map((assignment) => assignment.mission_id))];
    if (assignedMissionIds.length === 0) {
      return NextResponse.json({ success: false, error: "Program di luar cakupan fasilitator." }, { status: 403 });
    }
  }

  try {
    teams = await collectAllPages<TeamRecord>((from, to) => db
      .from("tbos_teams")
      .select("id, name, batch, batch_id, organization_id, engagement_id, batches ( id, name )")
      .eq("engagement_id", programId)
      .order("name", { ascending: true })
      .range(from, to) as never);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat tim." }, { status: 500 });
  }

  let observationRows: ObservationRecord[] = [];
  if (auth.role === "admin" || assignedMissionIds.length > 0) {
    try {
      observationRows = await collectAllPages<ObservationRecord>((from, to) => {
        let query = db.from("tbos_observations").select(`
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
       profiles (full_name),
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
          .eq("program_id", programId)
          .order("submitted_at", { ascending: false });
        if (auth.role !== "admin") query = query.in("mission_id", assignedMissionIds);
        return query.range(from, to) as never;
      });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat observasi." }, { status: 500 });
    }
  }

  const observations = observationRows;
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const transformedObservations = observations.map((observation) => {
    const common = {
      id: observation.id,
      teamId: observation.team_id,
      teamName: teamsById.get(observation.team_id)?.name || "-",
      missionId: observation.mission_id,
      missionCode: observation.tbos_missions?.code || "",
      missionName: observation.tbos_missions?.name || "-",
      batch: observation.batch,
      observedAt: observation.observed_at,
      submittedAt: observation.submitted_at,
      status: observation.status,
      scores: (observation.tbos_observation_scores || []).map((score) => ({
        dimensionCode: score.tbos_behavioral_dimensions?.code || "",
        dimensionName: score.tbos_behavioral_dimensions?.name || "",
        levelValue: score.level_value,
        levelLabel: ["", "Reactive", "Emerging", "Functional", "Effective", "Exemplary"][score.level_value] || "",
      })),
    };

    return auth.role === "admin"
      ? {
          ...common,
          profileId: observation.profile_id,
           facilitatorName: observation.profiles?.full_name || "-",
          notes: observation.notes,
        }
      : common;
  });

  const ownObservations = observations.filter((observation) => observation.profile_id === auth.userId);
  const ownScores = ownObservations.flatMap((observation) =>
    observation.tbos_observation_scores.map((score) => score.level_value)
  );
  const viewerStats = {
    role: auth.role,
    assignedTeamCount: auth.role === "admin" ? null : teams.length,
    assignedMissionCount: auth.role === "admin" ? null : assignedMissionIds.length,
    organizationCount: auth.role === "admin" ? null : new Set(teams.map((team) => team.organization_id).filter(Boolean)).size,
    scopedTeamCount: teams.length,
    ownObservationCount: ownObservations.length,
    ownTeamsObserved: new Set(ownObservations.map((observation) => observation.team_id)).size,
    ownAverageScore: ownScores.length > 0
      ? Math.round((ownScores.reduce((sum, score) => sum + score, 0) / ownScores.length) * 10) / 10
      : null,
  };

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
  for (const mapping of (missionDims || []) as unknown as MissionDimensionRecord[]) {
    const mCode = mapping.tbos_missions?.code;
    const dCode = mapping.tbos_behavioral_dimensions?.code;
    if (mCode && dCode) {
      if (!missionDimensionMap[mCode]) missionDimensionMap[mCode] = [];
      missionDimensionMap[mCode].push(dCode);
    }
  }

  return NextResponse.json({
    success: true,
    teams: teams.map(({ id, name, batch, batch_id, batches, engagement_id }) => {
      const batchRecord = Array.isArray(batches) ? batches[0] : batches;
      return {
        id,
        name,
        batch,
        batchId: batch_id,
        batchName: batchRecord?.name || batch,
        engagementId: engagement_id,
      };
    }),
    observations: transformedObservations,
    dimensions: dimensions || [],
    missions: missions || [],
    missionDimensionMap,
    viewerStats,
    generatedAt: new Date().toISOString(),
  });
}
