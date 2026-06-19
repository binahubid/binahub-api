export const masmindoCriteria = [
  { key: "terukur", label: "Terukur" },
  { key: "bertanggung_jawab", label: "Bertanggung Jawab" },
  { key: "kerja_sama_tim", label: "Kerja Sama Tim" },
  { key: "ketangkasan", label: "Ketangkasan" },
  { key: "kegigihan", label: "Kegigihan & Ketekunan" },
  { key: "berdedikasi", label: "Berdedikasi" },
] as const;

export type ScoringCriterionKey = (typeof masmindoCriteria)[number]["key"];

export const teamBuildingGames = [
  "Minefield Strategy",
  "Tower Challenge",
  "Bridge Builder",
  "Pipeline Flow",
  "Blind Drawing",
  "Problem Solving Race",
] as const;

export type TeamScore = {
  company: string;
  team: string;
  game: string;
  sessionCount: number;
  sessionNumber?: number;
  date: string;
  facilitator: string;
  scores: Record<ScoringCriterionKey, number>;
};

export const demoTeamScores: TeamScore[] = [
  {
    company: "PT Masmindo Dwi Area",
    team: "Tim A",
    game: "Minefield Strategy",
    sessionCount: 3,
    date: "2026-06-14",
    facilitator: "Fasilitator A",
    scores: {
      terukur: 3,
      bertanggung_jawab: 2,
      kerja_sama_tim: 5,
      ketangkasan: 2,
      kegigihan: 4,
      berdedikasi: 3,
    },
  },
  {
    company: "PT Masmindo Dwi Area",
    team: "Tim B",
    game: "Minefield Strategy",
    sessionCount: 3,
    date: "2026-06-14",
    facilitator: "Fasilitator B",
    scores: {
      terukur: 2,
      bertanggung_jawab: 4,
      kerja_sama_tim: 2,
      ketangkasan: 5,
      kegigihan: 3,
      berdedikasi: 2,
    },
  },
  {
    company: "PT Masmindo Dwi Area",
    team: "Tim C",
    game: "Minefield Strategy",
    sessionCount: 3,
    date: "2026-06-14",
    facilitator: "Fasilitator C",
    scores: {
      terukur: 4,
      bertanggung_jawab: 3,
      kerja_sama_tim: 3,
      ketangkasan: 3,
      kegigihan: 2,
      berdedikasi: 5,
    },
  },
];

export function getTotalScore(score: TeamScore["scores"]) {
  return Object.values(score).reduce((total, value) => total + value, 0);
}
