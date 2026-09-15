export type LiveTimerStatus = "ready" | "running" | "paused" | "finished";

export type LiveTimerRecord = {
  status: LiveTimerStatus;
  duration_seconds: number;
  remaining_seconds: number;
  ends_at: string | null;
};

export type LiveTeamCandidate = {
  teamId: string;
  teamName: string;
  batch: string;
  score: number | null;
  completedMissions: number;
  strongestDimension: string | null;
  lastScoredAt: string | null;
};

export type RankedLiveTeam = LiveTeamCandidate & { rank: number | null };

export function deriveLiveTimer(record: LiveTimerRecord, nowMs = Date.now()) {
  if (record.status !== "running" || !record.ends_at) {
    return { status: record.status, remainingSeconds: record.remaining_seconds };
  }

  const remainingSeconds = Math.max(0, Math.ceil((new Date(record.ends_at).getTime() - nowMs) / 1000));
  return {
    status: remainingSeconds === 0 ? "finished" as const : "running" as const,
    remainingSeconds,
  };
}

export function rankLiveTeams(teams: LiveTeamCandidate[]): RankedLiveTeam[] {
  const sorted = [...teams].sort((left, right) => {
    if (left.score === null && right.score === null) return left.teamName.localeCompare(right.teamName, "id");
    if (left.score === null) return 1;
    if (right.score === null) return -1;
    return right.score - left.score || right.completedMissions - left.completedMissions || left.teamName.localeCompare(right.teamName, "id");
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  return sorted.map((team, index) => {
    if (team.score === null) return { ...team, rank: null };
    const rank = previousScore === team.score ? previousRank : index + 1;
    previousScore = team.score;
    previousRank = rank;
    return { ...team, rank };
  });
}

export function liveCoverageIsAligned(teams: RankedLiveTeam[]) {
  const scored = teams.filter((team) => team.score !== null);
  return scored.length < 2 || new Set(scored.map((team) => team.completedMissions)).size === 1;
}
