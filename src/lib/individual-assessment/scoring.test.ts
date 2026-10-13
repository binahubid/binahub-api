import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { getPEParticipantDefinition, readPEInstrument, hashPEInstrument } from './definition';
import { PEResponsesSchema, scorePEResponses as calculatePE } from './scoring';

import { makeSyntheticPEInstrument } from './synthetic-fixture';
const privatePEBundle=readPEInstrument(makeSyntheticPEInstrument());
const PE_BUNDLE_SHA256=hashPEInstrument(privatePEBundle);
const scorePEResponses=(input:unknown)=>calculatePE(input,privatePEBundle);
const { config,key_actions:actions }=privatePEBundle;
describe('synthetic PE source and participant boundary', () => {
  it('pins the exact source, draft versions and all 25 key actions', () => {
    expect(config.competencies).toHaveLength(6);
    expect(config.self_report_items).toHaveLength(24);
    expect(config.sjt_items).toHaveLength(12);
    expect(actions).toHaveLength(25);
    expect(new Set(actions.map(a => a.code)).size).toBe(25);
    expect(Object.isFrozen(config.sjt_items[0].option_scores)).toBe(true);
    expect(privatePEBundle.metadata.public_enabled).toBe(false);
    expect(privatePEBundle.catalog_crosswalks.every(m => m.status === 'proposed')).toBe(true);
    expect(privatePEBundle.metadata.sources).toHaveLength(3);
    for (const source of privatePEBundle.metadata.sources) expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(PE_BUNDLE_SHA256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('has exact coverage and unambiguous per-method counts for every competency', () => {
    const allIds = [...config.self_report_items, ...config.sjt_items].map(i => i.id);
    expect(new Set(allIds).size).toBe(36);
    const mapped = new Set([...config.self_report_items.map(i => i.key_action_code), ...config.sjt_items.flatMap(i => i.key_action_codes)]);
    expect([...mapped].sort()).toEqual(actions.map(a => a.code).sort());
    for (const c of config.competencies) {
      expect(config.self_report_items.filter(i => i.competency_code === c.code)).toHaveLength(4);
      expect(config.sjt_items.filter(i => i.competency_code === c.code)).toHaveLength(2);
    }
    for (const item of config.sjt_items) {
      expect(item.options.map(o => o.id).sort()).toEqual(['A','B','C','D']);
      expect(Object.keys(item.option_scores).sort()).toEqual(['A','B','C','D']);
      expect(Object.keys(item.rationales).sort()).toEqual(['A','B','C','D']);
      expect(Math.max(...Object.values(item.option_scores))).toBe(3);
      expect(item.option_scores[item.scoring_key as 'A' | 'B' | 'C' | 'D']).toBe(3);
      expect(item.key_status).toBe('PROVISIONAL');
    }
  });
  it('strips every private key and rationale by explicit allowlist', () => {
    const dto = getPEParticipantDefinition(privatePEBundle);
    expect(dto.sjtItems).toHaveLength(12);
    expect(dto.selfReportScale.at(-1)).toEqual({ value: 'NA', label: 'Tidak ada kesempatan yang relevan' });
    expect(JSON.stringify(dto)).not.toMatch(/scoring_key|option_scores|rationales|key_status|sources|catalog_crosswalks/);
    for (const item of dto.sjtItems) expect(Object.keys(item).sort()).toEqual([
      'competencyCode','id','itemVersion','keyActionCodes','options','question','scenario','type',
    ]);
    const definitionSource = readFileSync('src/lib/individual-assessment/definition.ts','utf8');
    expect(definitionSource).toContain("import 'server-only'");
  });
});

describe('deterministic dual-method PE scoring', () => {
  it('excludes explicit NA and does not round intermediate values', () => {
    const score = scorePEResponses({ SR01: 4, SR02: 4, SR03: 5, SR04: 'NA', SJ01: 'A', SJ02: 'C' });
    expect(score.competencies[0].selfReport).toEqual({ status: 'scored', validCount: 3, naCount: 1,
      missingCount: 0, expectedCount: 4, rawSum: 13, mean: 4.33, score: 83.33 });
    expect(score.competencies[0].sjt.score).toBe(66.67);
    expect(score.completeness).toEqual({ expectedCount:36, answeredCount:6, missingCount:30, naCount:1, scoredMethods:2 });
  });
  it('distinguishes missing, NA, insufficient evidence, and a legitimate scored zero', () => {
    const score = scorePEResponses({ SR01:1, SR02:1, SR03:'NA', SJ01:'D', SJ02:'D' });
    expect(score.competencies[0].selfReport).toMatchObject({ status:'insufficient_evidence', validCount:2,naCount:1,missingCount:1,score:null,mean:null });
    expect(score.competencies[0].sjt).toMatchObject({ status:'scored',validCount:2,rawSum:0,score:0 });
    expect(score.competencies[1].sjt).toMatchObject({ status:'incomplete',validCount:0,score:null });
    expect(scorePEResponses({ SJ01:'A' }).competencies[0].sjt).toMatchObject({ status:'incomplete',rawSum:3,score:null });
  });
  it.each([1,2,3,4,5])('transforms SR %i on the declared 0–100 scale', value => {
    expect(scorePEResponses({ SR01:value,SR02:value,SR03:value }).competencies[0].selfReport.score).toBe((value-1)*25);
  });
  it('accepts an empty draft and reports each missing method without fabricated scores', () => {
    const result = scorePEResponses({});
    expect(result.completeness.scoredMethods).toBe(0);
    expect(result.completeness.missingCount).toBe(36);
    expect(result.competencies.every(c => c.selfReport.score === null && c.sjt.score === null)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/overall|composite|level|percentile|priorityScore|category|recommendations/);
  });
  it.each([null,[],{ SR01:null },{ SR01:0 },{ SR01:6 },{ SR01:1.5 },{ SR01:'5' },
    { SR01:'A' },{ SJ01:'NA' },{ SJ01:0 },{ SJ01:3 },{ SJ01:'E' },{ SJ99:'A' },{ SR25:4 },{ '1':3 },{ score:100 }])(
    'rejects malformed responses rather than coercing or silently ignoring them (%j)', value => {
      expect(PEResponsesSchema.safeParse(value).success).toBe(false);
      expect(() => scorePEResponses(value)).toThrow();
    });
  it('uses every provisional partial-credit score, not just the best-answer key', () => {
    for (const c of config.competencies) {
      const [first,second] = config.sjt_items.filter(i => i.competency_code === c.code);
      for (const a of ['A','B','C','D'] as const) for (const b of ['A','B','C','D'] as const) {
        const result = scorePEResponses({ [first.id]:a,[second.id]:b }).competencies.find(x => x.code===c.code)!;
        expect(result.sjt.rawSum).toBe(first.option_scores[a]+second.option_scores[b]);
        expect(result.sjt.score).toBe(Math.round((first.option_scores[a]+second.option_scores[b])/6*10000)/100);
      }
    }
  });
});
