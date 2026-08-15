export interface TbosScoreInput {
  dimensionCode: string;
  dimensionName: string;
  levelValue: number;
}

export interface TbosObservationInput {
  teamId: string;
  missionCode: string;
  status: string;
  scores: TbosScoreInput[];
}

export interface TbosDimensionScore {
  dimensionCode: string;
  dimensionName: string;
  score: number;
  observationCount: number;
}

export interface TbosMissionScore {
  missionCode: string;
  score: number | null;
}

export interface TbosTeamScore {
  overallScore: number | null;
  missionScores: TbosMissionScore[];
  dimensionScores: TbosDimensionScore[];
}

export function calculateTbosTeamScore(
  teamId: string,
  observations: TbosObservationInput[],
  missionDimensionMap: Record<string, string[]>
): TbosTeamScore {
  const teamObservations = observations.filter(
    (observation) => observation.teamId === teamId && observation.status !== "draft"
  );
  const dimensionAggregates = new Map<
    string,
    { total: number; count: number; name: string }
  >();

  for (const observation of teamObservations) {
    for (const score of observation.scores) {
      const aggregate = dimensionAggregates.get(score.dimensionCode) || {
        total: 0,
        count: 0,
        name: score.dimensionName,
      };
      aggregate.total += score.levelValue;
      aggregate.count += 1;
      dimensionAggregates.set(score.dimensionCode, aggregate);
    }
  }

  const dimensionScores = Array.from(dimensionAggregates, ([dimensionCode, aggregate]) => ({
    dimensionCode,
    dimensionName: aggregate.name,
    score: round1(aggregate.total / aggregate.count),
    observationCount: aggregate.count,
  }));
  const observedMissions = new Set(teamObservations.map((observation) => observation.missionCode));
  const missionScores: TbosMissionScore[] = [];

  for (const missionCode of observedMissions) {
    const relevantDimensions = missionDimensionMap[missionCode];
    if (!relevantDimensions) continue;

    const missionObservations = teamObservations.filter(
      (observation) => observation.missionCode === missionCode
    );
    const missionDimensionScores = new Map<string, { total: number; count: number }>();
    for (const observation of missionObservations) {
      for (const score of observation.scores) {
        const current = missionDimensionScores.get(score.dimensionCode) || { total: 0, count: 0 };
        current.total += score.levelValue;
        current.count += 1;
        missionDimensionScores.set(score.dimensionCode, current);
      }
    }

    const scores = relevantDimensions
      .map((dimensionCode) => {
        const aggregate = missionDimensionScores.get(dimensionCode);
        return aggregate ? round1(aggregate.total / aggregate.count) : undefined;
      })
      .filter((score): score is number => score !== undefined);

    missionScores.push({
      missionCode,
      score: scores.length > 0 ? round1(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    });
  }

  const validMissionScores = missionScores
    .map((mission) => mission.score)
    .filter((score): score is number => score !== null);

  return {
    overallScore:
      validMissionScores.length > 0
        ? round1(validMissionScores.reduce((sum, score) => sum + score, 0) / validMissionScores.length)
        : null,
    missionScores,
    dimensionScores,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
