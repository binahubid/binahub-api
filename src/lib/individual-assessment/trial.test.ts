import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { validateRMInstrument } from '../relationship-management/instrument';
import { trialDefinition, trialReport, type TrialSource } from './trial';

function rm(): TrialSource {
  const names = ['Communication', 'Presentation & Public Speaking', 'Professional Presence', 'Relationship Building', 'Trust Building', 'Collaboration', 'Influencing', 'Conflict Management', 'Customer Orientation'];
  return { product: 'rm', instrument: validateRMInstrument({
    metadata: { version: '4.0.0-draft.1', status: 'draft', publicEnabled: false, sources: [{ file: 'synthetic.docx', sha256: 'a'.repeat(64) }, { file: 'synthetic.xlsx', sha256: 'b'.repeat(64) }], reportSelfReportCount: 24, bankSelfReportCount: 27 },
    competencies: names.map((name, i) => ({ code: `RM-${String(i + 7).padStart(2, '0')}`, name, definition: 'Test definition', behaviorAnchors: ['PRIVATE_ANCHOR'], candidates: [{ code: 'SS-04', name: 'Test program', alignment: 'Core' }], deliveryNote: 'Internal', validation: 'Internal' })),
    scale: Array.from({ length: 5 }, (_, i) => ({ value: i + 1, label: `Choice ${i + 1}` })),
    selfReportItems: names.flatMap((_, i) => Array.from({ length: 3 }, (_, j) => ({ id: `RM-SR-0${i + 1}-0${j + 1}`, competencyCode: `RM-${String(i + 7).padStart(2, '0')}`, prompt: 'Test question', behaviorAnchor: 'PRIVATE_ITEM_ANCHOR' }))),
    sjtItems: Array.from({ length: 13 }, (_, i) => ({ id: `RM-SJT-${String(i + 1).padStart(2, '0')}`, title: 'Test case', scenario: 'Test scenario', options: ['A', 'B', 'C', 'D'].map(id => ({ id, text: `Choice ${id}` })), tags: ['RM-07'], bestOption: 'B', scores: { A: 0, B: 3, C: 1, D: 2 }, rationale: 'PRIVATE_RATIONALE' })), scoringPolicy: null,
  }) };
}
const sources = (): TrialSource[] => [{ product: 'pe', instrument: makeSyntheticPEInstrument() }, rm()];
describe('actual scoring behind mock-payment demonstration', () => {
  it.each([0, 1])('uses full private-source bank and strips every scoring secret (%s)', n => {
    const d = trialDefinition(sources()[n]);
    expect(d.definition.selfReportItems).toHaveLength(n === 0 ? 24 : 27);
    expect(d.definition.sjtItems).toHaveLength(n === 0 ? 12 : 13);
    for (const secret of ['PRIVATE_', 'Synthetic action', 'scoring_key', 'option_scores', 'rationales', 'bestOption', 'behaviorAnchor', 'tags', 'scoringPolicy', 'key_action']) expect(JSON.stringify(d)).not.toContain(secret);
    expect(d.offer.price).toBe(n === 0 ? 59000 : 89000);
  });
  it.each([0, 1])('returns separate methods and 50:50 combined without fabricating RM competency SJT (%s)', n => {
    const source = sources()[n], d = trialDefinition(source);
    const responses = Object.fromEntries([...d.definition.selfReportItems.map(q => [q.id, 5]), ...d.definition.sjtItems.map(q => [q.id, n === 0 ? 'D' : 'A'])]);
    const report = trialReport(source, { product: source.product, revision: d.revision, responses });
    expect(report.moduleProfile).toEqual({ combined: 50, selfReport: 100, sjt: 0 });
    expect(report.areas).toHaveLength(n === 0 ? 6 : 9);
    if (n === 1) expect(report.areas.every(a => a.sjt === null && a.combined === null)).toBe(true);
    else expect(report.areas.every(a => a.sjt === 0 && a.combined === 50)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_|scoring_key|rationale|key_action/);
  });
  it.each([0, 1])('rejects missing, invalid, mixed-product, unknown and stale submissions (%s)', n => {
    const source = sources()[n], d = trialDefinition(source);
    const responses = Object.fromEntries([...d.definition.selfReportItems.map(q => [q.id, 5]), ...d.definition.sjtItems.map(q => [q.id, 'A'])]);
    const body = { product: source.product, revision: d.revision, responses };
    expect(() => trialReport(source, { ...body, responses: {} })).toThrow();
    expect(() => trialReport(source, { ...body, responses: { ...responses, [d.definition.selfReportItems[0].id]: 'A' } })).toThrow();
    expect(() => trialReport(source, { ...body, responses: { ...responses, unknown: 5 } })).toThrow();
    expect(() => trialReport(source, { ...body, revision: '0'.repeat(64) })).toThrow('TRIAL_SOURCE_CHANGED');
    expect(() => trialReport(source, { ...body, product: source.product === 'pe' ? 'rm' : 'pe' })).toThrow('TRIAL_SOURCE_CHANGED');
    expect(() => trialReport(source, { ...body, paymentStatus: 'paid' })).toThrow();
  });
  it('does not convert PE NA/insufficient evidence into zero or a combined score', () => {
    const source = sources()[0], d = trialDefinition(source);
    const responses = Object.fromEntries([...d.definition.selfReportItems.map(q => [q.id, 'NA']), ...d.definition.sjtItems.map(q => [q.id, 'A'])]);
    expect(trialReport(source, { product: 'pe', revision: d.revision, responses }).moduleProfile).toEqual({ selfReport: null, sjt: 100, combined: null });
  });
});
