import { describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { buildPEEvaluationExport } from './evaluation';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { scorePEResponses } from './scoring';
const bundle=makeSyntheticPEInstrument();
const competencies=scorePEResponses({},bundle).competencies.filter(c=>['PE-02','PE-04','PE-06'].includes(c.code));
describe('pseudonymous evaluation export',()=>{
  const rows=Array.from({length:5},(_,i)=>({instrumentVersion:'1.0.0-draft.1',scoringVersion:'pe-dual-method-v1',
    responses:{SR01:i===0?'NA':4},competencies,elapsedSeconds:60+i*60,clarity:4,usefulness:4}));
  it('labels paused duration accurately, suppresses small cells and uses export-local codes',()=>{
    const value=buildPEEvaluationExport(rows);expect(value.descriptive.elapsedMedianSeconds).toBe(180);
    expect(value.descriptive.items[0].distribution).toEqual({'4':null,NA:null});
    expect(value.records[0].participantCode).toBe('P0001');expect(value.sampleUnit).toContain('not a verified unique-person');
  });
  it('rejects identity or free context fields and undersized exports',()=>{
    expect(()=>buildPEEvaluationExport(rows.slice(0,4))).toThrow();
    expect(()=>buildPEEvaluationExport(rows.map(r=>({...r,email:'person@example.invalid'})))).toThrow();
  });
});
