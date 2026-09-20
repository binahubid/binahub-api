import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { buildTbosProgramReport, TBOS_REPORT_DIMENSIONS } from "./tbos-report-data";
import { TbosGroupReportDocument } from "./tbos-report-document";

const teams = [
  {
    id: "team-garuda-kencana",
    name: "Garuda Kencana",
    batch: "Batch 1",
    facilitatorName: "Dian Puspitasari",
    notes: "Arah dan pembagian peran jelas; perlu lebih konsisten membandingkan alternatif dengan data.",
    scores: [5, 4, 4, 5, 4, 4, 5, 4],
    members: [
      ["Raka Pratama", true],
      ["Ayu Lestari", false],
      ["Bima Saputra", false],
      ["Citra Maharani", false],
      ["Dedi Kurniawan", false],
      ["Farah Nabila", false],
      ["Gilang Ramadhan", false],
      ["Intan Permata", false],
      ["Joko Setiawan", false],
      ["Laras Wulandari", false],
    ],
  },
  {
    id: "team-cakrawala-nusantara",
    name: "Cakrawala Nusantara",
    batch: "Batch 1",
    facilitatorName: "Fajar Hidayat",
    notes: "Kolaborasi dan adaptasi baik; keputusan penting belum selalu memakai data yang tersedia.",
    scores: [4, 4, 3, 3, 4, 4, 4, 3],
    members: [
      ["Nadia Putri", true],
      ["Aditya Nugroho", false],
      ["Bella Oktaviani", false],
      ["Chandra Wijaya", false],
      ["Eka Fitriani", false],
      ["Hendra Gunawan", false],
      ["Maya Sari", false],
      ["Reza Maulana", false],
      ["Siti Rahmawati", false],
      ["Yoga Prakoso", false],
    ],
  },
  {
    id: "team-rajawali-sinergi",
    name: "Rajawali Sinergi",
    batch: "Batch 1",
    facilitatorName: "Maya Kusumawardani",
    notes: "Potensi analitis terlihat, namun komunikasi, koordinasi, dan kepemilikan masalah perlu diperkuat.",
    scores: [3, 2, 3, 3, 2, 4, 2, 3],
    members: [
      ["Arief Wicaksono", true],
      ["Desi Anggraini", false],
      ["Febriansyah Putra", false],
      ["Indah Safitri", false],
      ["Kevin Santoso", false],
      ["Lina Marlina", false],
      ["Muhammad Iqbal", false],
      ["Novi Yuliani", false],
      ["Rizky Firmansyah", false],
      ["Tika Handayani", false],
    ],
  },
].map((team) => ({
  ...team,
  members: team.members.map(([name, isCaptain]) => ({
    name: String(name),
    isCaptain: Boolean(isCaptain),
  })),
}));

const observations = teams.map((team, index) => ({
  id: `${team.id}-observation`,
  teamId: team.id,
  missionCode: "program_observation",
  missionName: "Observasi Kompetensi Program",
  facilitatorName: team.facilitatorName,
  observedAt: `2026-08-${String(12 + index).padStart(2, "0")}T09:00:00+07:00`,
  submittedAt: `2026-08-${String(12 + index).padStart(2, "0")}T11:30:00+07:00`,
  status: "submitted",
  notes: team.notes,
  scores: TBOS_REPORT_DIMENSIONS.map((dimension, dimensionIndex) => ({
    dimensionCode: dimension.code,
    dimensionName: dimension.name,
    levelValue: team.scores[dimensionIndex],
  })),
}));

const report = buildTbosProgramReport({
  program: {
    id: "program-arunika-batch-1",
    code: "TBOS-AKI-B01",
    title: "PT Arunika Karya Indonesia - Leadership Acceleration Journey 2026",
    startDate: "2026-08-12",
    endDate: "2026-08-14",
  },
  teams,
  observations,
  generatedAt: "2026-08-15T10:00:00+07:00",
  dimensionCodes: TBOS_REPORT_DIMENSIONS.map((dimension) => dimension.code),
});

describe("T-BOS client sample group PDF", () => {
  it("renders Batch 1 with three teams, thirty members, and all competencies", async () => {
    expect(report.teams).toHaveLength(3);
    expect(report.teams.every((team) => team.members.length === 10)).toBe(true);
    expect(report.teams.every((team) => team.dimensions.every((dimension) => dimension.score !== null))).toBe(true);
    expect(report.totalObservations).toBe(3);

    const buffer = await renderToBuffer(<TbosGroupReportDocument report={report} batch="Batch 1" />);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(10_000);

    const outputPath = process.env.TBOS_CLIENT_SAMPLE_PDF_OUTPUT;
    if (outputPath) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, buffer);
    }
  });
});
