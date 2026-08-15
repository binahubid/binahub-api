export const TBOS_REPORT_DIMENSIONS = [
  { code: "goal_alignment", name: "Goal Alignment", color: "#2563EB" },
  { code: "communication", name: "Communication", color: "#06B6D4" },
  { code: "data_based_decision", name: "Data-Based Decision Making", color: "#8B5CF6" },
  { code: "execution_discipline", name: "Execution Discipline", color: "#F59E0B" },
  { code: "accountability", name: "Accountability", color: "#F43F5E" },
  { code: "adaptability", name: "Adaptability", color: "#10B981" },
  { code: "collaboration", name: "Collaboration", color: "#14B8A6" },
  { code: "org_ownership", name: "Organizational Ownership", color: "#6366F1" },
] as const;

export interface TbosReportMember {
  name: string;
  isCaptain: boolean;
}

export interface TbosReportScoreInput {
  dimensionCode: string;
  dimensionName: string;
  levelValue: number;
}

export interface TbosReportObservationInput {
  id: string;
  teamId: string;
  missionCode: string;
  missionName: string;
  facilitatorName: string;
  observedAt: string;
  submittedAt: string;
  status: string;
  notes: string | null;
  scores: TbosReportScoreInput[];
}

export interface TbosReportTeamInput {
  id: string;
  name: string;
  batch: string;
  members: TbosReportMember[];
}

export interface TbosDimensionResult {
  code: string;
  name: string;
  color: string;
  score: number | null;
  observationCount: number;
}

export interface TbosMissionResult {
  code: string;
  name: string;
  score: number | null;
  facilitatorName: string;
  observedAt: string;
  notes: string | null;
}

export interface TbosTeamReport {
  id: string;
  name: string;
  batch: string;
  members: TbosReportMember[];
  captainName: string | null;
  overallScore: number | null;
  observations: TbosReportObservationInput[];
  missions: TbosMissionResult[];
  dimensions: TbosDimensionResult[];
  strongestDimension: TbosDimensionResult | null;
  developmentDimension: TbosDimensionResult | null;
}

export interface TbosBatchDimensionResult {
  batch: string;
  dimensions: TbosDimensionResult[];
  overallScore: number | null;
}

export interface TbosProgramReport {
  program: {
    id: string;
    code: string;
    title: string;
    startDate: string | null;
    endDate: string | null;
  };
  teams: TbosTeamReport[];
  dimensions: TbosDimensionResult[];
  batches: TbosBatchDimensionResult[];
  strengths: TbosDimensionResult[];
  developmentAreas: TbosDimensionResult[];
  totalObservations: number;
  overallScore: number | null;
  generatedAt: string;
}

export function buildTbosProgramReport(input: {
  program: TbosProgramReport["program"];
  teams: TbosReportTeamInput[];
  observations: TbosReportObservationInput[];
  generatedAt?: string;
}): TbosProgramReport {
  const teamReports = input.teams.map((team) => buildTeamReport(team, input.observations));
  const dimensions = aggregateTeamDimensions(teamReports);
  const scoredDimensions = dimensions.filter((dimension) => dimension.score !== null);
  const sortedDimensions = [...scoredDimensions].sort((a, b) => (b.score || 0) - (a.score || 0));
  const strengths = sortedDimensions.slice(0, 3);
  const strengthCodes = new Set(strengths.map((dimension) => dimension.code));
  const developmentAreas = [...sortedDimensions]
    .reverse()
    .filter((dimension) => !strengthCodes.has(dimension.code))
    .slice(0, 3);
  const teamScores = teamReports
    .map((team) => team.overallScore)
    .filter((score): score is number => score !== null);

  const batches = [...new Set(input.teams.map((team) => team.batch).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "id-ID"))
    .map((batch) => {
      const batchTeams = teamReports.filter((team) => team.batch === batch);
      const batchScores = batchTeams.map((team) => team.overallScore).filter((score): score is number => score !== null);
      return {
        batch,
        dimensions: aggregateTeamDimensions(batchTeams),
        overallScore: average(batchScores),
      };
    });

  return {
    program: input.program,
    teams: teamReports,
    dimensions,
    batches,
    strengths,
    developmentAreas,
    totalObservations: input.observations.length,
    overallScore: average(teamScores),
    generatedAt: input.generatedAt || new Date().toISOString(),
  };
}

function buildTeamReport(team: TbosReportTeamInput, observations: TbosReportObservationInput[]): TbosTeamReport {
  const teamObservations = observations.filter((observation) => observation.teamId === team.id);
  const dimensions = TBOS_REPORT_DIMENSIONS.map((dimension) => {
    const values = teamObservations.flatMap((observation) =>
      observation.scores
        .filter((score) => score.dimensionCode === dimension.code)
        .map((score) => score.levelValue),
    );
    return {
      ...dimension,
      score: average(values),
      observationCount: values.length,
    };
  });

  const observationsByMission = new Map<string, TbosReportObservationInput[]>();
  for (const observation of teamObservations) {
    const current = observationsByMission.get(observation.missionCode) || [];
    current.push(observation);
    observationsByMission.set(observation.missionCode, current);
  }
  const missions = Array.from(observationsByMission, ([code, missionObservations]) => {
    const scores = missionObservations.flatMap((observation) => observation.scores.map((score) => score.levelValue));
    const latest = [...missionObservations].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    return {
      code,
      name: latest?.missionName || code,
      score: average(scores),
      facilitatorName: latest?.facilitatorName || "-",
      observedAt: latest?.observedAt || "",
      notes: latest?.notes || null,
    };
  });
  const missionScores = missions.map((mission) => mission.score).filter((score): score is number => score !== null);
  const scoredDimensions = dimensions.filter((dimension) => dimension.score !== null);
  const sortedDimensions = [...scoredDimensions].sort((a, b) => (b.score || 0) - (a.score || 0));

  return {
    id: team.id,
    name: team.name,
    batch: team.batch,
    members: team.members,
    captainName: team.members.find((member) => member.isCaptain)?.name || null,
    overallScore: average(missionScores),
    observations: teamObservations,
    missions,
    dimensions,
    strongestDimension: sortedDimensions[0] || null,
    developmentDimension: sortedDimensions[sortedDimensions.length - 1] || null,
  };
}

function aggregateTeamDimensions(teams: TbosTeamReport[]): TbosDimensionResult[] {
  return TBOS_REPORT_DIMENSIONS.map((dimension) => {
    const values = teams
      .map((team) => team.dimensions.find((item) => item.code === dimension.code)?.score ?? null)
      .filter((score): score is number => score !== null);
    return {
      ...dimension,
      score: average(values),
      observationCount: values.length,
    };
  });
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}
