import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { readPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { buildPEDevelopmentReport,projectPEFreeDefinition,createPEParticipantStore } from './delivery';
import { scorePEResponses } from './scoring';
import { PE_FREE_CODES,PE_POLICY_ID,type PEDeliveryAttempt } from './delivery-contracts';

const instrument=readPEInstrument(makeSyntheticPEInstrument());
function attempt():PEDeliveryAttempt {
  const responses=Object.fromEntries([...instrument.config.self_report_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,3]),
    ...instrument.config.sjt_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,'A'])]) as PEDeliveryAttempt['responses'];
  const result=scorePEResponses(responses,instrument);
  const now=new Date().toISOString();
  return {id:randomUUID(),policyId:PE_POLICY_ID,status:'submitted',revision:1,responses,
    context:{role:'Manager',goal:'Grow',relevance:{'PE-02':'normal','PE-04':'high','PE-06':'low'}},
    createdAt:now,updatedAt:now,submittedAt:now,retentionUntil:now,
    result:{instrumentId:'BINAINSIGHTS-PE-V1',instrumentVersion:'1.0.0-draft.1',scoringVersion:'pe-dual-method-v1',
      policyId:PE_POLICY_ID,reportVersion:'pe-web-development-v1',priorityVersion:'pe-relevance-evidence-v1',
      releaseStatus:'development_pilot',contentReview:'ceo_reviewed',completeness:{expectedCount:18,answeredCount:18,naCount:0},
      competencies:result.competencies.filter(c=>PE_FREE_CODES.includes(c.code as never))}};
}
describe('participant projections and transparent development report',()=>{
  it('returns only the three free competencies and their complete item sets',()=>{
    const dto=projectPEFreeDefinition(instrument);
    expect(dto.competencies.map(c=>c.code)).toEqual([...PE_FREE_CODES]);
    expect(dto.selfReportItems).toHaveLength(12);expect(dto.sjtItems).toHaveLength(6);
    expect(JSON.stringify(dto)).not.toMatch(/PE-01|PE-03|PE-05|scoring_key|option_scores|rationales|catalog_crosswalks|sha256/);
  });
  it('requires a final result and ranks context/evidence first without clinical or level claims',()=>{
    const a=attempt(),report=buildPEDevelopmentReport(a,instrument);
    expect(report.priorities.map(p=>p.code)).toEqual(['PE-04','PE-02']);
    expect(report.areas.map(c=>c.code)).toEqual([...PE_FREE_CODES]);
    expect(report.priorities[0].practice?.focus).toContain('Synthetic action');
    expect(JSON.stringify(report)).not.toMatch(/overall|category|composite|percentile|option_scores|scoring_key|PE-01|PE-03|PE-05/);
    expect(()=>buildPEDevelopmentReport({...a,status:'draft'},instrument)).toThrow('PE_RESULT_NOT_READY');
  });
  it('does not rank an Area when evidence is insufficient or job relevance is low',()=>{
    const a=attempt();a.result!.competencies[1].selfReport.status='insufficient_evidence';a.result!.competencies[1].selfReport.score=null;
    expect(buildPEDevelopmentReport(a,instrument).priorities.map(p=>p.code)).toEqual(['PE-02']);
  });
  it('binds the authenticated owner in the adapter, rejects forged caller fields and filters errors',async()=>{
    const owner=randomUUID(),a=attempt();const rpc=vi.fn().mockResolvedValue({data:a,error:null});
    const store=createPEParticipantStore({rpc} as unknown as Pick<SupabaseClient,'rpc'>,owner);
    expect(await store.read(a.id)).toEqual(a);expect(rpc.mock.calls[0][1].p_owner).toBe(owner);
    await expect(store.write(a.id,{revision:1,responses:{},owner_id:randomUUID()})).rejects.toThrow();
    rpc.mockResolvedValueOnce({data:null,error:{message:'PE_ENTITLEMENT_REQUIRED details private'}});
    await expect(store.read(a.id)).rejects.toThrow(/^PE_ENTITLEMENT_REQUIRED$/);
    rpc.mockResolvedValueOnce({data:null,error:{message:'private database diagnostic'}});
    await expect(store.read(a.id)).rejects.toThrow(/^PE_STORAGE_UNAVAILABLE$/);
  });
});
