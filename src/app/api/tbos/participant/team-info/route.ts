import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { getUserFromBearer } from "@/lib/auth-role";
import { calculateTbosTeamScore } from "@/lib/tbos-scoring";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { z } from "zod";
import { collectAllPages } from "@/lib/pagination";

interface TeamRecord {
  id: string;
  name: string;
  batch: string;
  batch_id: string | null;
  organization_id: string | null;
  engagement_id: string;
  batches?: { id: string; name: string }[] | { id: string; name: string } | null;
}

interface MissionDimensionRecord {
  tbos_missions: { code: string } | null;
  tbos_behavioral_dimensions: { code: string } | null;
}

interface ObservationRecord {
  id: string;
  team_id: string;
  mission_id: string;
  batch: string;
  status: string;
  tbos_missions: { code: string; name: string } | null;
  tbos_observation_scores: Array<{
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | null;
  }>;
}

/**
 * GET /api/tbos/participant/team-info
 * Returns T-BOS team info for the authenticated participant:
 * - Team name & batch
 * - Missions completed count
 * - Overall score, strongest/weakest dimensions
 * - Rank among scored teams in the participant team's organization
 *
 * No admin role required — any authenticated user can access their own team data.
 */
export async function GET(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const userId = auth.user.id;
  const db = createServerSupabase();
  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }
  const { data: profile, error: profileError } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (profileError) return NextResponse.json({ success: false, error: profileError.message }, { status: 500 });
  if (profile?.role !== "peserta") {
    return NextResponse.json({ success: false, error: "Akses khusus peserta." }, { status: 403 });
  }
  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 403 });
  }

  // 1. Find the participant's team via tbos_team_members
  const { data: membership, error: memberError } = await db
    .from("tbos_team_members")
    .select(`
      team_id,
      tbos_teams!inner (
        id,
        name,
        batch,
        batch_id,
        organization_id,
        engagement_id,
        batches ( id, name )
      )
    `)
    .eq("profile_id", userId)
    .eq("tbos_teams.engagement_id", programId)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json({ success: false, error: memberError.message }, { status: 500 });
  }

  if (!membership || !membership.tbos_teams) {
    // User is not a member of any team
    return NextResponse.json({ success: true, teamInfo: null });
  }

  const team = membership.tbos_teams as unknown as TeamRecord;
  const teamId = team.id;
  const teamName = team.name;
  const batchRecord = Array.isArray(team.batches) ? team.batches[0] : team.batches;
  const batch = batchRecord?.name || team.batch;
  // 2. Rank only inside the same program, never across engagements.
  let cohortTeams: Array<{ id: string }>;
  try {
    cohortTeams = await collectAllPages<{ id: string }>((from, to) => db
      .from("tbos_teams")
      .select("id")
      .eq("engagement_id", programId)
      .range(from, to));
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat tim." }, { status: 500 });
  }

  // 3. Fetch all observations (submitted/locked) for scoring
  let allObservations: ObservationRecord[];
  try {
    allObservations = await collectAllPages<ObservationRecord>((from, to) => db
      .from("tbos_observations")
      .select(`
      id,
      team_id,
      mission_id,
      batch,
      status,
      tbos_missions (code, name),
      tbos_observation_scores (
        dimension_id,
        level_value,
        tbos_behavioral_dimensions (code, name)
      )
      `)
      .in("status", ["submitted", "locked"])
      .eq("program_id", programId)
      .range(from, to) as never);
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat observasi." }, { status: 500 });
  }

  const { data: missionDimensions, error: missionDimensionsError } = await db
    .from("tbos_mission_dimensions")
    .select(`
      tbos_missions (code),
      tbos_behavioral_dimensions (code)
    `);

  if (missionDimensionsError) {
    return NextResponse.json({ success: false, error: missionDimensionsError.message }, { status: 500 });
  }

  const missionDimensionMap: Record<string, string[]> = {};
  for (const mapping of (missionDimensions || []) as unknown as MissionDimensionRecord[]) {
    const missionCode = mapping.tbos_missions?.code;
    const dimensionCode = mapping.tbos_behavioral_dimensions?.code;
    if (!missionCode || !dimensionCode) continue;
    if (!missionDimensionMap[missionCode]) missionDimensionMap[missionCode] = [];
    missionDimensionMap[missionCode].push(dimensionCode);
  }

  const observations = allObservations.map((obs) => ({
    id: obs.id,
    teamId: obs.team_id,
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "",
    batch: obs.batch,
    status: obs.status,
    scores: (obs.tbos_observation_scores || []).map((s) => ({
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
    })),
  }));

  // 4. Calculate the participant team's canonical scores
  const teamObservations = observations.filter((observation) => observation.teamId === teamId);

  // Count unique missions
  const missionsCompleted = new Set(teamObservations.map((observation) => observation.missionId)).size;

  const teamScore = calculateTbosTeamScore(teamId, observations, missionDimensionMap);
  const sortedDimensions = [...teamScore.dimensionScores].sort((a, b) => b.score - a.score);
  const overallScore = teamScore.overallScore;
  const strongestDimension = sortedDimensions[0]?.dimensionName || null;
  const weakestDimension = sortedDimensions[sortedDimensions.length - 1]?.dimensionName || null;

  // 5. Rank only against scored teams in the same organization.
  let rank: number | null = null;
  const scoredCohort = cohortTeams
    .map((cohortTeam) => ({
      teamId: cohortTeam.id,
      score: calculateTbosTeamScore(cohortTeam.id, observations, missionDimensionMap).overallScore,
    }))
    .filter((entry): entry is { teamId: string; score: number } => entry.score !== null);
  const rankCohortSize = scoredCohort.length;

  if (overallScore !== null) {
    scoredCohort.sort((a, b) => b.score - a.score);
    const rankIndex = scoredCohort.findIndex((entry) => entry.teamId === teamId);
    rank = rankIndex === -1 ? null : rankIndex + 1;
  }

  return NextResponse.json({
    success: true,
    teamInfo: {
      teamName,
      batch,
      batchName: batch,
      missionsCompleted,
      overallScore,
      strongestDimension,
      weakestDimension,
      rank,
      rankCohortSize,
    },
  });
}
