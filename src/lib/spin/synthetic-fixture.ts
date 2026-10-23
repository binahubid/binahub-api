import type { SpinNeeds } from './recommendation';

/** Synthetic workflow evidence. Never a real customer assessment or scoring key. */
export function syntheticSpinNeeds(overrides: Partial<SpinNeeds> = {}): SpinNeeds {
  return {
    summaryStatus: 'confirmed', problemCluster: 'C2', audience: 'manager', participantCount: 20,
    programScope: 'one_team', spiritualOptIn: 'unknown', barriers: [], priorOutcome: 'none', conflicts: [],
    evidence: [
      { id: 'Q05.1', text: 'Rapat tidak terarah dan keputusan tidak ditindaklanjuti.' },
      { id: 'Q13', text: 'Rapat menghasilkan keputusan, penanggung jawab, dan tindak lanjut yang jelas.' },
    ],
    ...overrides,
  };
}

export const syntheticSpinSelection = (solutionCode = 'SS-29', objectiveId = `${solutionCode}.LO01`) => ({
  matches: [{ solutionCode, evidenceLinks: [
    { evidenceId: 'Q05.1', objectiveId }, { evidenceId: 'Q13', objectiveId },
  ] }],
});
