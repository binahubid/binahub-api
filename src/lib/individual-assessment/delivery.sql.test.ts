import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import catalog from '@/data/competency-catalog-2026.json';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { hashPEInstrument } from './definition';
import { PE_FREE_CODES,PE_CONSENT_VERSION,PE_PRIVACY_VERSION,PEDeliveryAttemptSchema } from './delivery-contracts';
import { scorePEResponses } from './scoring';

const db=new PGlite(),owner=randomUUID(),bundle=makeSyntheticPEInstrument();
const migration=readFileSync('supabase/migrations/0065_personal_effectiveness_delivery.sql','utf8');
const context={role:'Manager',goal:'Improve work habits',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}};
const answers=Object.fromEntries([
  ...bundle.config.self_report_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,4]),
  ...bundle.config.sjt_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,'A']),
]);
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,
      is_mock boolean default false,catalog_version text default 'signature-2026-ceo-v1',base_price numeric default 25000000,metadata jsonb default '{}');`);
  for(const m of catalog.solutions)await db.query('insert into catalog_modules(module_code) values($1)',[m.moduleCode]);
  await db.exec(readFileSync('supabase/migrations/0063_competency_dictionary.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8'));
  await db.query('select pe_register_draft_instrument_v1($1::jsonb,$2)',[JSON.stringify(bundle),hashPEInstrument(bundle)]);
  await db.exec(migration);
},30_000);
afterAll(()=>db.close());
async function start(id:string=randomUUID(),user:string=owner,ctx:unknown=context,consent:string=PE_CONSENT_VERSION){
  const response=await db.query<{value:unknown}>('select pe_start_participant($1,$2,$3::jsonb,$4,$5) as value',
    [id,user,JSON.stringify(ctx),consent,PE_PRIVACY_VERSION]);return PEDeliveryAttemptSchema.parse(response.rows[0].value);
}
async function write(id:string,revision:number,responses:unknown,key:string|null=null,user=owner){
  return PEDeliveryAttemptSchema.parse((await db.query<{value:unknown}>(
    'select pe_write_participant($1,$2,$3,$4::jsonb,$5) as value',[id,user,revision,JSON.stringify(responses),key])).rows[0].value);
}
describe('SQL65 free-3 delivery',()=>{
  it('records CEO domain review, approved maps and six-month policy without rewriting instrument history',async()=>{
    expect((await db.query('select release_status,content_review,retention_months,free_codes from pe_delivery_policies')).rows)
      .toEqual([{release_status:'development_pilot',content_review:'ceo_reviewed',retention_months:6,free_codes:[...PE_FREE_CODES]}]);
    expect((await db.query("select count(*)::int as n from pe_catalog_crosswalks where status='approved' and reviewer_name='CEO'")).rows).toEqual([{n:6}]);
    expect((await db.query('select manifest from pe_instrument_versions')).rows).toEqual([{manifest:bundle}]);
  });
  it('is safe to reapply without duplicate constraints or resetting attempts',async()=>{
    const a=await start();await write(a.id,0,{SR05:'NA'});await db.exec(migration);
    expect((await db.query('select revision from pe_participant_attempts where id=$1',[a.id])).rows).toEqual([{revision:1}]);
  });
  it('starts idempotently, binds identity, requires consent/context and bounds retake confusion',async()=>{
    const a=await start();expect((await start(a.id)).id).toBe(a.id);
    await expect(start(a.id,randomUUID())).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await expect(start(a.id,owner,{...context,goal:'changed'})).rejects.toThrow('PE_START_CONFLICT');
    await expect(start(randomUUID(),owner,context,'wrong')).rejects.toThrow('PE_CONSENT_REQUIRED');
    for(const ctx of [null,{}, {...context,role:''}, {...context,owner_id:randomUUID()}, {...context,relevance:{'PE-01':'high'}}]){
      await expect(start(randomUUID(),owner,ctx)).rejects.toThrow('PE_INVALID_CONTEXT');
    }
  });
  it('saves, resumes, rejects stale versions, and does not accept locked-area answers',async()=>{
    const a=await start();const saved=await write(a.id,0,{SR05:4,SJ03:'D'});
    expect(saved.revision).toBe(1);
    const read=await db.query('select pe_read_participant($1,$2) as value',[a.id,owner]);expect(read.rows[0]).toEqual({value:saved});
    await expect(write(a.id,0,{})).rejects.toThrow('PE_REVISION_CONFLICT');
    await expect(write(a.id,1,{SR01:4})).rejects.toThrow('PE_ENTITLEMENT_REQUIRED');
    await expect(write(a.id,1,{SJ01:'A'})).rejects.toThrow('PE_ENTITLEMENT_REQUIRED');
    await expect(write(a.id,1,{SR05:null})).rejects.toThrow('PE_INVALID_RESPONSE');
  });
  it('requires all 18 answers at submit, permits NA without fabricated scores, and filters result data in SQL',async()=>{
    const a=await start();await expect(write(a.id,0,{SR05:4},'submit_key_00000001')).rejects.toThrow('PE_ANSWERS_INCOMPLETE');
    const result=await write(a.id,0,answers,'submit_key_00000001');
    expect(result.result?.competencies).toEqual(scorePEResponses(answers,bundle).competencies.filter(c=>PE_FREE_CODES.includes(c.code as never)));
    expect(result.result?.completeness).toEqual({expectedCount:18,answeredCount:18,naCount:0});
    expect(JSON.stringify(result)).not.toMatch(/PE-01|PE-03|PE-05|scoring_key|option_scores|rationales/);
    expect(await write(a.id,0,answers,'submit_key_00000001')).toEqual(result);
    await expect(write(a.id,1,answers,'submit_key_00000002')).rejects.toThrow('PE_ATTEMPT_FINALIZED');
    const other=await start();const allNA={...answers,SR05:'NA',SR06:'NA',SR07:'NA',SR08:'NA'};
    expect((await write(other.id,0,allNA,'submit_key_00000003')).result?.competencies[0].selfReport.score).toBeNull();
  });
  it('denies other users every read/write/erase operation',async()=>{
    const a=await start(),stranger=randomUUID();
    await expect(write(a.id,0,{},null,stranger)).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await expect(db.query('select pe_read_participant($1,$2)',[a.id,stranger])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await expect(db.query('select pe_erase_participant($1,$2)',[a.id,stranger])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
  });
  it('closes expired access and deletes expired answers/results in bounded batches',async()=>{
    const a=await start();await write(a.id,0,answers,'submit_key_00000004');
    await db.query("update pe_participant_attempts set retention_until=now()-interval '1 day' where id=$1",[a.id]);
    await expect(db.query('select pe_read_participant($1,$2)',[a.id,owner])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    expect((await db.query('select pe_purge_expired_participants(100) as n')).rows).toEqual([{n:1}]);
    expect((await db.query('select * from pe_participant_attempts where id=$1',[a.id])).rows).toHaveLength(0);
    expect((await db.query('select pe_purge_expired_participants(100) as n')).rows).toEqual([{n:0}]);
  });
  it('allows deletion by the owner but denies direct browser access and service-role row writes',async()=>{
    const a=await start();await db.query('select pe_erase_participant($1,$2)',[a.id,owner]);
    for(const table of ['pe_delivery_policies','pe_participant_attempts','pe_participant_events']){
      for(const role of ['anon','authenticated'])expect((await db.query(`select has_table_privilege('${role}',$1,'select,insert,update,delete') as ok`,[table])).rows).toEqual([{ok:false}]);
      expect((await db.query("select has_table_privilege('service_role',$1,'insert,update,delete') as ok",[table])).rows).toEqual([{ok:false}]);
    }
    for(const fn of ['pe_start_participant(uuid,uuid,jsonb,text,text)','pe_read_participant(uuid,uuid)',
      'pe_write_participant(uuid,uuid,int,jsonb,text)','pe_erase_participant(uuid,uuid)','pe_purge_expired_participants(int)']){
      for(const role of ['anon','authenticated'])expect((await db.query(`select has_function_privilege('${role}',$1,'execute') as ok`,[fn])).rows).toEqual([{ok:false}]);
    }
    await db.exec('set role service_role');try{const b=await start();expect((await write(b.id,0,{SR05:4})).revision).toBe(1);}
    finally{await db.exec('reset role');}
  });
});
