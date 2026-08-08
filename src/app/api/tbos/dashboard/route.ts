import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

interface TeamRecord {
  id: string;
  name: string;
  batch: string;
  organization_id: string | null;
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

  // Debug: check if service role key is loaded
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("[T-BOS Dashboard] SUPABASE_SERVICE_ROLE_KEY is not set!");
    return NextResponse.json(
      { success: false, error: "Server configuration error: missing service role key." },
      { status: 500 }
    );
  }

  let teams: TeamRecord[] = [];
  let assignedTeamCount = 0;
  let organizationCount = 0;

  if (auth.role === "admin") {
    const { data, error } = await db
      .from("tbos_teams")
      .select("id, name, batch, organization_id")
      .order("batch", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[T-BOS Dashboard] teams query error:", JSON.stringify(error));
      return NextResponse.json({ success: false, error: error.message, code: error.code, hint: error.hint }, { status: 500 });
    }

    teams = (data || []) as TeamRecord[];
  } else {
    const { data: assignments, error: assignmentError } = await db
      .from("tbos_facilitator_teams")
      .select("team_id")
      .eq("profile_id", auth.userId);

    if (assignmentError) {
      console.error("[T-BOS Dashboard] assignment query error:", assignmentError);
      return NextResponse.json({ success: false, error: "Gagal memuat cakupan fasilitator." }, { status: 500 });
    }

    const assignedTeamIds = [...new Set((assignments || []).map((assignment) => assignment.team_id))];
    assignedTeamCount = assignedTeamIds.length;

    if (assignedTeamIds.length > 0) {
      const { data: assignedTeams, error: assignedTeamsError } = await db
        .from("tbos_teams")
        .select("id, name, batch, organization_id")
        .in("id", assignedTeamIds);

      if (assignedTeamsError) {
        console.error("[T-BOS Dashboard] assigned teams query error:", assignedTeamsError);
        return NextResponse.json({ success: false, error: "Gagal memuat cakupan fasilitator." }, { status: 500 });
      }

      const assignedTeamRows = (assignedTeams || []) as TeamRecord[];
      const organizationIds = [...new Set(
        assignedTeamRows
          .map((team) => team.organization_id)
          .filter((organizationId): organizationId is string => Boolean(organizationId))
      )];
      organizationCount = organizationIds.length;

      let organizationTeams: TeamRecord[] = [];
      if (organizationIds.length > 0) {
        const { data, error } = await db
          .from("tbos_teams")
          .select("id, name, batch, organization_id")
          .in("organization_id", organizationIds);

        if (error) {
          console.error("[T-BOS Dashboard] organization teams query error:", error);
          return NextResponse.json({ success: false, error: "Gagal memuat cakupan organisasi." }, { status: 500 });
        }
        organizationTeams = (data || []) as TeamRecord[];
      }

      teams = [...new Map(
        [...assignedTeamRows, ...organizationTeams].map((team) => [team.id, team])
      ).values()].sort((left, right) =>
        left.batch.localeCompare(right.batch) || left.name.localeCompare(right.name)
      );
    }
  }

  let observationsQuery = db
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
    .in("status", ["submitted", "locked"]);

  if (auth.role !== "admin") {
    const scopedTeamIds = teams.map((team) => team.id);
    if (scopedTeamIds.length === 0) {
      observationsQuery = observationsQuery.eq("profile_id", auth.userId).limit(0);
    } else {
      observationsQuery = observationsQuery.in("team_id", scopedTeamIds);
    }
  }

  const { data: observationRows, error: obsError } = await observationsQuery
    .order("submitted_at", { ascending: false });

  if (obsError) {
    console.error("[T-BOS Dashboard] observations query error:", JSON.stringify(obsError));
    return NextResponse.json({ success: false, error: obsError.message, code: obsError.code, hint: obsError.hint, detail: obsError.details }, { status: 500 });
  }

  const observations = (observationRows || []) as unknown as ObservationRecord[];
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const profileIds = [...new Set(observations.map((observation) => observation.profile_id))];
  const { data: profileRows, error: profileError } = profileIds.length > 0
    ? await db.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [], error: null };

  if (profileError) {
    console.error("[T-BOS Dashboard] profile query error:", JSON.stringify(profileError));
    return NextResponse.json({ success: false, error: profileError.message, code: profileError.code, hint: profileError.hint, detail: profileError.details }, { status: 500 });
  }

  const profilesById = new Map((profileRows || []).map((profile) => [profile.id, profile.full_name]));
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
           facilitatorName: profilesById.get(observation.profile_id) || "-",
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
    assignedTeamCount: auth.role === "admin" ? null : assignedTeamCount,
    organizationCount: auth.role === "admin" ? null : organizationCount,
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
    teams: teams.map(({ id, name, batch }) => ({ id, name, batch })),
    observations: transformedObservations,
    dimensions: dimensions || [],
    missions: missions || [],
    missionDimensionMap,
    viewerStats,
    generatedAt: new Date().toISOString(),
  });
}
