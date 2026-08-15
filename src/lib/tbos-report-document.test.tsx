import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { buildTbosProgramReport, TBOS_REPORT_DIMENSIONS } from "./tbos-report-data";
import { TbosGroupReportDocument, TbosTeamReportDocument } from "./tbos-report-document";

const teams = ["Alpha", "Bravo", "Charlie", "Delta"].map((name, index) => ({
  id: `team-${index + 1}`,
  name,
  batch: index < 2 ? "Batch 1" : "Batch 2",
  members: [
    { name: `${name} Captain`, isCaptain: true },
    { name: `${name} Member 1`, isCaptain: false },
    { name: `${name} Member 2`, isCaptain: false },
    { name: `${name} Member 3`, isCaptain: false },
  ],
}));

const observations = teams.flatMap((team, teamIndex) => [0, 1, 2, 3, 4].map((missionIndex) => ({
  id: `${team.id}-obs-${missionIndex}`,
  teamId: team.id,
  missionCode: `mission-${missionIndex + 1}`,
  missionName: ["Lost Detonator Mission", "Goldsmith Precision Lab", "Ore Extraction Challenge", "Lean Bridge Challenge", "X-Case"][missionIndex],
  facilitatorName: `Fasilitator ${missionIndex + 1}`,
  observedAt: `2026-08-${String(missionIndex + 1).padStart(2, "0")}T08:00:00Z`,
  submittedAt: `2026-08-${String(missionIndex + 1).padStart(2, "0")}T08:05:00Z`,
  status: "submitted",
  notes: missionIndex === 0 ? "Tim membagi peran sejak awal." : null,
  scores: TBOS_REPORT_DIMENSIONS
    .filter((_, dimensionIndex) => dimensionIndex % 5 === missionIndex || dimensionIndex % 3 === missionIndex % 3)
    .map((dimension, dimensionIndex) => ({
      dimensionCode: dimension.code,
      dimensionName: dimension.name,
      levelValue: ((teamIndex + missionIndex + dimensionIndex) % 5) + 1,
    })),
})));

const report = buildTbosProgramReport({
  program: {
    id: "program-qa",
    code: "TBOS-QA-2026",
    title: "Leadership Rotation Program 2026",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  },
  teams,
  observations,
  generatedAt: "2026-08-15T10:00:00+07:00",
});

describe("T-BOS PDF documents", () => {
  it("renders the complete group report", async () => {
    const buffer = await renderToBuffer(<TbosGroupReportDocument report={report} />);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(10_000);
    writeQaOutput(process.env.TBOS_GROUP_PDF_QA_OUTPUT, buffer);
  });

  it("renders an individual team report", async () => {
    const buffer = await renderToBuffer(<TbosTeamReportDocument report={report} team={report.teams[0]} />);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(3_000);
    writeQaOutput(process.env.TBOS_TEAM_PDF_QA_OUTPUT, buffer);
  });
});

function writeQaOutput(path: string | undefined, buffer: Buffer) {
  if (!path) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buffer);
}
