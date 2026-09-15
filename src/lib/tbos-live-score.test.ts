import { describe, expect, it } from "vitest";
import { deriveLiveTimer, liveCoverageIsAligned, rankLiveTeams } from "./tbos-live-score";

describe("T-BOS live score", () => {
  it("derives the countdown from the server deadline", () => {
    expect(deriveLiveTimer({ status: "running", duration_seconds: 600, remaining_seconds: 600, ends_at: "2026-09-15T01:10:00.000Z" }, Date.parse("2026-09-15T01:09:15.000Z"))).toEqual({ status: "running", remainingSeconds: 45 });
  });

  it("finishes a timer that has elapsed", () => {
    expect(deriveLiveTimer({ status: "running", duration_seconds: 60, remaining_seconds: 60, ends_at: "2026-09-15T01:00:00.000Z" }, Date.parse("2026-09-15T01:00:01.000Z"))).toEqual({ status: "finished", remainingSeconds: 0 });
  });

  it("uses shared ranks for equal scores and keeps unscored teams last", () => {
    const ranked = rankLiveTeams([
      { teamId: "3", teamName: "Belum", batch: "A", score: null, completedMissions: 0, strongestDimension: null, lastScoredAt: null },
      { teamId: "2", teamName: "Beta", batch: "A", score: 4.2, completedMissions: 2, strongestDimension: "Kolaborasi", lastScoredAt: null },
      { teamId: "1", teamName: "Alpha", batch: "A", score: 4.2, completedMissions: 2, strongestDimension: "Komunikasi", lastScoredAt: null },
    ]);
    expect(ranked.map((team) => [team.teamName, team.rank])).toEqual([["Alpha", 1], ["Beta", 1], ["Belum", null]]);
    expect(liveCoverageIsAligned(ranked)).toBe(true);
  });

  it("marks different mission coverage as provisional", () => {
    const ranked = rankLiveTeams([
      { teamId: "1", teamName: "Alpha", batch: "A", score: 4, completedMissions: 2, strongestDimension: null, lastScoredAt: null },
      { teamId: "2", teamName: "Beta", batch: "A", score: 3.8, completedMissions: 1, strongestDimension: null, lastScoredAt: null },
    ]);
    expect(liveCoverageIsAligned(ranked)).toBe(false);
  });
});
