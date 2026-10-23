import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { PEResponsesSchema } from './contracts';
import { hashPEInstrument, readPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { makeSyntheticV2Sources } from './v2-source-fixture';
import { canonical, compareV2WithV1, digest, getV2ParticipantDefinition, getV2PreparationSummary,
  projectV2SourceParticipant, scoreV2Responses, validateV2Sources, V2_CODES, V2_FREE_CODES,
} from '../../../scripts/lib/binainsights-v2.mjs';

function setup() {
  const { source, crosswalk } = makeSyntheticV2Sources();
  const participant = projectV2SourceParticipant(source);
  return { source, crosswalk, participant,
    bundle: validateV2Sources(source, participant, crosswalk) };
}

describe('PE V2 preparation source adapter', () => {
  it('pins versions and coverage without mutating or replacing V1', () => {
    const old = readPEInstrument(makeSyntheticPEInstrument()), before = hashPEInstrument(old);
    const { bundle } = setup();
    expect(getV2PreparationSummary(bundle)).toMatchObject({ totalItems: 37, freeItems: 18,
      additionalItems: 19, selfReportItems: 24, scenarios: 13, catalogCompetencies: 34,
      catalogSolutions: 32, catalogLinks: 173, pendingProducts: ['SS-32'], status: 'prepared_not_active' });
    expect(hashPEInstrument(old)).toBe(before);
    expect(old.config.sjt_items).toHaveLength(12);
    expect(PEResponsesSchema.safeParse({ SJ13: 'A' }).success).toBe(false);
    expect(() => readPEInstrument(bundle.instrument)).toThrow();
  });

  it('clones and freezes validated content so caller mutation cannot change a replay', () => {
    const { source, bundle } = setup();
    source.sjt_items[0].option_scores.A = 0;
    expect(bundle.instrument.sjt_items[0].option_scores.A).toBe(3);
    expect(Object.isFrozen(bundle.instrument.sjt_items[0].option_scores)).toBe(true);
    expect(Object.isFrozen(bundle.crosswalk.solutions[0].core)).toBe(true);
  });

  it('requires a validated bundle and an explicit, nonduplicated entitlement', () => {
    const { bundle } = setup();
    expect(() => getV2ParticipantDefinition({ ...bundle }, V2_FREE_CODES)).toThrow('BINA_V2_VALIDATION_REQUIRED');
    for (const codes of [[], ['PE-07'], ['PE-02', 'PE-02'], null, 'all']) {
      expect(() => getV2ParticipantDefinition(bundle, codes)).toThrow('BINA_V2_ENTITLEMENT_INVALID');
    }
    expect(() => scoreV2Responses(bundle, {}, [])).toThrow('BINA_V2_ENTITLEMENT_INVALID');
  });

  it('exports only entitled questions with no keys, rationales or editorial notes', () => {
    const { bundle } = setup();
    const dto = getV2ParticipantDefinition(bundle, V2_FREE_CODES);
    expect(dto.expectedCount).toBe(18);
    expect(dto.selfReportItems).toHaveLength(12);
    expect(dto.sjtItems).toHaveLength(6);
    expect(dto.competencies.map((c: { code: string }) => c.code)).toEqual(V2_FREE_CODES);
    expect(dto.publicEnabled).toBe(false);
    expect(JSON.stringify(dto)).not.toMatch(/scoring_key|option_scores|rationales|key_status|review_status|design_note|interpretation|sources|key_action_reference|catalogCrosswalk/);
    expect(dto.sjtItems.some((i: { id: string }) => i.id === 'SJ13')).toBe(false);
    expect(Object.keys(dto.sjtItems[0]).sort()).toEqual([
      'competencyCode', 'id', 'itemVersion', 'keyActionCodes', 'options', 'question', 'scenario', 'type',
    ]);
  });

  it('compares the entire supplied participant projection and rejects extra fields or edits', () => {
    for (const change of [
      (p: ReturnType<typeof projectV2SourceParticipant>) => { p.sjt_items[0].scoring_key = 'A'; },
      (p: ReturnType<typeof projectV2SourceParticipant>) => { p.sjt_items[0].options[0].text = 'changed'; },
      (p: ReturnType<typeof projectV2SourceParticipant>) => { p.self_report_items.pop(); },
    ]) {
      const { source, crosswalk } = makeSyntheticV2Sources(), participant = projectV2SourceParticipant(source);
      change(participant);
      expect(() => validateV2Sources(source, participant, crosswalk)).toThrow('BINA_V2_PARTICIPANT_MISMATCH');
    }
  });

  it('rejects foreign versions, malformed items, action links, unsafe scoring and changed product readiness', () => {
    const mutations: Array<(s: ReturnType<typeof makeSyntheticV2Sources>) => void> = [
      f => { f.source.assessment.id = 'BINAINSIGHTS-PE-V1'; },
      f => { f.source.assessment.version = 'invented'; },
      f => { f.source.assessment.catalog_version = 'v5'; },
      f => { f.source.assessment.sjt_count = 12; },
      f => { f.source.self_report_items.pop(); },
      f => { f.source.self_report_items[1].id = 'SR01'; },
      f => { f.source.self_report_items[0].key_action_code = 'KA06.4'; },
      f => { f.source.sjt_items[12].competency_code = 'PE-02'; },
      f => { f.source.sjt_items[0].key_action_codes = ['KA01.1', 'KA01.1']; },
      f => { f.source.sjt_items[0].options[0].id = 'B'; },
      f => { f.source.sjt_items[0].option_scores.A = 2; },
      f => { f.source.sjt_items[0].option_scores.B = 4; },
      f => { f.source.sjt_items[0].key_status = 'APPROVED'; },
      f => { f.source.scoring.sjt.minimum_valid_scenarios_per_competency = 1 as never; },
      f => { f.source.scoring.self_report.minimum_valid_items_per_competency = 2 as never; },
      f => { f.source.report_rules.sjt_public_key_prohibition = false; },
      f => { f.crosswalk.solutions[0].secondary.push(f.crosswalk.solutions[0].core[0]); },
      f => { f.crosswalk.solutions[31].available_for_final_recommendation = true; },
      f => { f.crosswalk.solutions.pop(); },
    ];
    for (const change of mutations) {
      const fixture = makeSyntheticV2Sources();
      change(fixture);
      expect(() => validateV2Sources(fixture.source,
        projectV2SourceParticipant(fixture.source), fixture.crosswalk)).toThrow('BINA_V2_SOURCE_INVALID');
    }
  });

  it('uses stable hashes independent of JSON key insertion order, while preserving array order', () => {
    expect(digest({ b: 2, a: { z: 3, x: 1 } })).toBe(digest({ a: { x: 1, z: 3 }, b: 2 }));
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
    expect(() => canonical(undefined)).toThrow('BINA_NON_JSON_VALUE');
  });

  it('compares reused IDs by content and emits only a redacted, non-migrating source diff', () => {
    const fixture = makeSyntheticV2Sources();
    fixture.source.self_report_items[0].prompt = 'An invented revised prompt.';
    fixture.source.sjt_items[1].option_scores.B = 1;
    const bundle = validateV2Sources(fixture.source, projectV2SourceParticipant(fixture.source), fixture.crosswalk);
    const comparison = compareV2WithV1(bundle, fixture.old);
    expect(comparison.sharedItemIds).toHaveLength(36);
    expect(comparison.changedItemIds).toEqual(['SR01', 'SJ02']);
    expect(comparison.addedItemIds).toEqual(['SJ13']);
    expect(comparison.removedItemIds).toEqual([]);
    expect(comparison.automaticAnswerMigrationAllowed).toBe(false);
    expect(JSON.stringify(comparison)).not.toMatch(/Invented|Synthetic|invented|prompt|scoring_key|option_scores|rationales/);
    expect(() => compareV2WithV1(bundle, fixture.source)).toThrow('BINA_V1_COMPARISON_SOURCE_INVALID');
  });
});

describe('PE V2 deterministic preview and replay', () => {
  it('uses 2/3 versus 3/3 Integrity coverage and does not round intermediate means', () => {
    const { bundle } = setup();
    const partial = scoreV2Responses(bundle, { SR01: 4, SR02: 4, SR03: 5, SR04: 'NA',
      SJ01: 'A', SJ02: 'C' }, V2_CODES);
    expect(partial.competencies[0].selfReport).toMatchObject({ mean: 4.33, score: 83.33,
      validCount: 3, naCount: 1, missingCount: 0 });
    expect(partial.competencies[0].sjt).toMatchObject({ score: 66.67, maximum: 6,
      validCount: 2, missingCount: 1, expectedCount: 3 });
    const full = scoreV2Responses(bundle, { SJ01: 'A', SJ02: 'C', SJ13: 'D' }, V2_CODES);
    expect(full.competencies[0].sjt).toMatchObject({ score: 44.44, maximum: 9,
      validCount: 3, missingCount: 0, expectedCount: 3 });
  });

  it('distinguishes all-NA, missing, a single scenario and a legitimate scored zero', () => {
    const { bundle } = setup();
    const result = scoreV2Responses(bundle, { SR01: 'NA', SR02: 'NA', SR03: 'NA', SR04: 'NA',
      SJ01: 'D', SJ02: 'D' }, ['PE-01']);
    expect(result.competencies[0].selfReport).toMatchObject({ score: null, validCount: 0, naCount: 4, missingCount: 0 });
    expect(result.competencies[0].sjt).toMatchObject({ score: 0, validCount: 2, missingCount: 1 });
    expect(scoreV2Responses(bundle, { SJ13: 'A' }, ['PE-01']).competencies[0].sjt)
      .toMatchObject({ status: 'incomplete', validCount: 1, score: null });
    expect(scoreV2Responses(bundle, {}, V2_FREE_CODES).completeness)
      .toEqual({ expectedCount: 18, answeredCount: 0, missingCount: 18, naCount: 0 });
  });

  it('derives 18/19/37 from the entitled items, without representing hidden areas as zero', () => {
    const { bundle } = setup();
    for (const [codes, expected] of [[V2_FREE_CODES, 18], [['PE-01', 'PE-03', 'PE-05'], 19], [V2_CODES, 37]] as const) {
      const dto = getV2ParticipantDefinition(bundle, codes);
      const responses = Object.fromEntries([
        ...dto.selfReportItems.map((i: { id: string }) => [i.id, 4]),
        ...dto.sjtItems.map((i: { id: string }) => [i.id, 'A']),
      ]);
      const result = scoreV2Responses(bundle, responses, codes);
      expect(result.completeness).toEqual({ expectedCount: expected, answeredCount: expected, missingCount: 0, naCount: 0 });
      expect(result.competencies).toHaveLength(codes.length);
      expect(result.competencies.every(c =>
        c.selfReport.score === 75 && c.sjt.score === 100)).toBe(true);
      expect(JSON.stringify(result)).not.toMatch(/overall|composite|percentile|proficiency|priorityScore|recommendations/);
    }
    expect(() => scoreV2Responses(bundle, { SJ13: 'A' }, V2_FREE_CODES)).toThrow('BINA_V2_RESPONSES_INVALID');
    expect(() => scoreV2Responses(bundle, { SR01: 4 }, V2_FREE_CODES)).toThrow('BINA_V2_RESPONSES_INVALID');
  });

  it.each([null, [], { SR01: null }, { SR01: 0 }, { SR01: 6 }, { SR01: 1.5 },
    { SR01: '5' }, { SR01: 'A' }, { SJ01: 0 }, { SJ01: 'NA' }, { SJ01: 'E' },
    { SR999: 4 }, { SJ14: 'A' }, { score: 100 }, { SR01: NaN }, { SR01: Infinity }])(
    'rejects unknown or malformed answers without coercion or silent omission (%j)', input => {
      expect(() => scoreV2Responses(setup().bundle, input, V2_CODES)).toThrow('BINA_V2_RESPONSES_INVALID');
    });
});
