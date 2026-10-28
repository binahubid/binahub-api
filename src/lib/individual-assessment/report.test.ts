import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { readPEInstrument } from './definition';
import { scorePEResponses } from './scoring';
import { buildPEReport } from './report';
import { PE_FREE_CODES, type PEDeliveryAttempt } from './delivery-contracts';
const instrument=readPEInstrument(makeSyntheticPEInstrument());
function attempt():PEDeliveryAttempt{
  const responses=Object.fromEntries([...instrument.config.self_report_items.filter(item=>PE_FREE_CODES.includes(item.competency_code as never)).map(item=>[item.id,4]),
    ...instrument.config.sjt_items.filter(item=>PE_FREE_CODES.includes(item.competency_code as never)).map(item=>[item.id,'A'])]) as PEDeliveryAttempt['responses'];
  const result=scorePEResponses(responses,instrument);
  return {id:'00000000-0000-4000-8000-000000000001',policyId:'pe-free3-2026-10-13-v1',status:'submitted',revision:1,
    context:{role:'Manager',goal:'Improve coordination',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}},responses,
    createdAt:'2026-10-13T18:00:00Z',updatedAt:'2026-10-13T18:10:00Z',submittedAt:'2026-10-13T18:10:00Z',retentionUntil:'2027-04-14T18:00:00Z',
    result:{instrumentId:'BINAINSIGHTS-PE-V1',instrumentVersion:'1.0.0-draft.1',scoringVersion:'pe-dual-method-v1',policyId:'pe-free3-2026-10-13-v1',reportVersion:'pe-web-development-v1',releaseStatus:'development_pilot',contentReview:'ceo_reviewed',priorityVersion:'pe-relevance-evidence-v1',
      completeness:{expectedCount:18,answeredCount:18,naCount:0},competencies:result.competencies.filter(row=>PE_FREE_CODES.includes(row.code as never))}};
}
describe('source-grounded report',()=>{
  it('includes versions, exact completeness and concrete localized follow-up without inventing a meeting',()=>{
    const report=buildPEReport(attempt(),instrument);
    expect(report.summary.answeredCount).toBe(18);expect(report.metadata.instrumentVersion).toBe('1.0.0-draft.1');
    expect(report.areas[0].practice?.followUpDate).toBe('2026-11-13');
    expect(report.areas[0].combinedScore).toBe((report.areas[0].selfReport.score!+report.areas[0].sjt.score!)/2);
    expect(report.metadata.displayScoringVersion).toBe('pe-display-equal-methods-v1');
    expect(report.areas[0].practice?.context).toContain('Manager');expect(report.areas[0].practice?.context).toContain('Improve coordination');
    expect(report.areas[0].interpretation).toBe(report.areas[0].practice?.focus);expect(report.integrity).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(report)).not.toMatch(/scoring_key|option_scores|rationales|overall|percentile/);
  });
  it('does not invent evidence or force three priorities when NA leaves a method unscored',()=>{
    const data=attempt();data.result!.competencies[0].selfReport.score=null;data.result!.competencies[0].selfReport.status='insufficient_evidence';
    const report=buildPEReport(data,instrument);expect(report.summary.areasWithBothMethods).toBe(2);
    expect(report.priorities.map(value=>value.code)).not.toContain('PE-02');expect(report.areas[0].interpretation).toContain('Bukti belum lengkap');
  });
});
