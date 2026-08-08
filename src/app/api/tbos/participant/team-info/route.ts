import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { getUserFromBearer } from "@/lib/auth-role";

/**
 * GET /api/tbos/participant/team-info
 * Returns T-BOS team info for the authenticated participant:
 * - Team name & batch
 * - Missions completed count
 * - Overall score, strongest/weakest dimensions
 * - Rank among all teams
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

  // 1. Find the participant's team via tbos_team_members
  const { data: membership, error: memberError } = await db
    .from("tbos_team_members")
    .select(`
      team_id,
      tbos_teams (
        id,
        name,
        batch
      )
    `)
    .eq("profile_id", userId)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json({ success: false, error: memberError.message }, { status: 500 });
  }

  if (!membership || !membership.tbos_teams) {
    // User is not a member of any team
    return NextResponse.json({ success: true, teamInfo: null });
  }

  const team = membership.tbos_teams as any;
  const teamId = team.id;
  const teamName = team.name;
  const batch = team.batch;

  // 2. Fetch all teams for ranking
  const { data: allTeams } = await db
    .from("tbos_teams")
    .select("id, name, batch");

  // 3. Fetch all observations (submitted/locked) for scoring
  const { data: allObservations } = await db
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
    .in("status", ["submitted", "locked"]);

  const observations = (allObservations || []).map((obs: any) => ({
    id: obs.id,
    teamId: obs.team_id,
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "",
    batch: obs.batch,
    status: obs.status,
    scores: (obs.tbos_observation_scores || []).map((s: any) => ({
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
    })),
  }));

  // 4. Calculate team's own observations
  const teamObservations = observations.filter((o: any) => o.teamId === teamId);

  // Count unique missions
  const missionsCompleted = new Set(teamObservations.map((o: any) => o.missionId)).size;

  // Calculate dimension averages for this team
  const dimScores = new Map<string, { total: number; count: number; name: string }>();
  for (const obs of teamObservations) {
    for (const score of obs.scores) {
      const existing = dimScores.get(score.dimensionCode) || { total: 0, count: 0, name: score.dimensionName };
      existing.total += score.levelValue;
      existing.count += 1;
      dimScores.set(score.dimensionCode, existing);
    }
  }

  // Overall score = average of all dimension averages
  let overallScore: number | null = null;
  let strongestDimension: string | null = null;
  let weakestDimension: string | null = null;

  if (dimScores.size > 0) {
    const dimAverages: { code: string; name: string; avg: number }[] = [];
    for (const [code, data] of dimScores) {
      dimAverages.push({ code, name: data.name, avg: data.total / data.count });
    }

    const totalAvg = dimAverages.reduce((a, b) => a + b.avg, 0) / dimAverages.length;
    overallScore = Math.round(totalAvg * 10) / 10;

    const sorted = [...dimAverages].sort((a, b) => b.avg - a.avg);
    strongestDimension = sorted[0]?.name || null;
    weakestDimension = sorted[sorted.length - 1]?.name || null;
  }

  // 5. Calculate rank — compute overallTeamScore for ALL teams, then sort
  let rank: number | null = null;
  if (allTeams && allTeams.length > 0 && overallScore !== null) {
    const teamScores: { teamId: string; score: number }[] = [];

    for (const t of allTeams) {
      const tObs = observations.filter((o: any) => o.teamId === t.id);
      const tDimScores = new Map<string, { total: number; count: number }>();

      for (const obs of tObs) {
        for (const score of obs.scores) {
          const existing = tDimScores.get(score.dimensionCode) || { total: 0, count: 0 };
          existing.total += score.levelValue;
          existing.count += 1;
          tDimScores.set(score.dimensionCode, existing);
        }
      }

      if (tDimScores.size > 0) {
        const avgs: number[] = [];
        for (const [, data] of tDimScores) {
          avgs.push(data.total / data.count);
        }
        const teamAvg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
        teamScores.push({ teamId: t.id, score: Math.round(teamAvg * 10) / 10 });
      }
    }

    teamScores.sort((a, b) => b.score - a.score);
    const rankIndex = teamScores.findIndex((t) => t.teamId === teamId);
    rank = rankIndex !== -1 ? rankIndex + 1 : null;
  }

  return NextResponse.json({
    success: true,
    teamInfo: {
      teamName,
      batch,
      missionsCompleted,
      overallScore,
      strongestDimension,
      weakestDimension,
      rank,
    },
  });
}
