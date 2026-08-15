import { describe, expect, it } from "vitest";
import { buildTbosProgramReport } from "./tbos-report-data";

describe("buildTbosProgramReport", () => {
  it("calculates mission-balanced team score and always returns eight dimensions", () => {
    const report = buildTbosProgramReport({
      program: { id: "program-1", code: "TEST", title: "Program Test", startDate: null, endDate: null },
      teams: [{ id: "team-1", name: "Alpha", batch: "Batch 1", members: [{ name: "Ari", isCaptain: true }] }],
      observations: [
        {
          id: "obs-1",
          teamId: "team-1",
          missionCode: "m1",
          missionName: "Misi 1",
          facilitatorName: "Fasilitator A",
          observedAt: "2026-01-01T00:00:00Z",
          submittedAt: "2026-01-01T00:00:00Z",
          status: "submitted",
          notes: null,
          scores: [
            { dimensionCode: "goal_alignment", dimensionName: "Goal Alignment", levelValue: 5 },
            { dimensionCode: "communication", dimensionName: "Communication", levelValue: 3 },
          ],
        },
        {
          id: "obs-2",
          teamId: "team-1",
          missionCode: "m2",
          missionName: "Misi 2",
          facilitatorName: "Fasilitator B",
          observedAt: "2026-01-01T01:00:00Z",
          submittedAt: "2026-01-01T01:00:00Z",
          status: "locked",
          notes: null,
          scores: [{ dimensionCode: "accountability", dimensionName: "Accountability", levelValue: 2 }],
        },
      ],
      generatedAt: "2026-01-02T00:00:00Z",
    });

    expect(report.teams[0].overallScore).toBe(3);
    expect(report.teams[0].dimensions).toHaveLength(8);
    expect(report.teams[0].captainName).toBe("Ari");
    expect(report.totalObservations).toBe(2);
  });
});
