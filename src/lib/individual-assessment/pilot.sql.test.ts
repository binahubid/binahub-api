import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,it,expect } from 'vitest';
import catalog from '@/data/competency-catalog-2026.json';
import { preparePEDeployment } from '../../../scripts/prepare-pe-deployment.mjs';
import { makeSyntheticPEInstrument } from './synthetic-fixture';

const db=new PGlite(),bundle=makeSyntheticPEInstrument(),owner=randomUUID(),actor=randomUUID();
const migration=readFileSync('supabase/migrations/0066_personal_effectiveness_review_pilot.sql','utf8');
const context={role:'Synthetic role',goal:'Synthetic goal',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}};
const answers=Object.fromEntries([...bundle.config.self_report_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,4]),
  ...bundle.config.sjt_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,'A'])]);
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:Record<string,unknown>}>(
  `select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
async function start(id=randomUUID(),who=owner,sharing:string|null='pe-consultant-review-v1'){
  return await call('pe_start_participant_v2',[id,who,JSON.stringify(context),'pe-development-consent-v1','pe-personal-privacy-v1',sharing,'instagram']);
}
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,is_mock boolean default false,
    catalog_version text default 'signature-2026-ceo-v1',base_price numeric default 25000000,metadata jsonb default '{}');`);
  for(const m of catalog.solutions)await db.query('insert into catalog_modules(module_code) values($1)',[m.moduleCode]);
  await db.exec(readFileSync('supabase/migrations/0063_competency_dictionary.sql','utf8'));
  await db.exec(preparePEDeployment(bundle,readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8')));
  await db.exec(readFileSync('supabase/migrations/0065_personal_effectiveness_delivery.sql','utf8'));
  await db.exec(migration);
},30_000);
afterAll(()=>db.close());
describe('PE review privacy and pilot operations',()=>{
  it('does not grant access to historical private results',async()=>{
    const id=randomUUID();await call('pe_start_participant',[id,owner,JSON.stringify(context),'pe-development-consent-v1','pe-personal-privacy-v1']);
    await expect(call('pe_admin_review_case',[id])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    expect((await call('pe_owner_review_access',[id,owner])).shared).toBe(false);
  });
  it('shares only after explicit consent, binds ownership and supports revocation without retry regrant',async()=>{
    const id=randomUUID();await start(id);
    expect((await call('pe_admin_review_case',[id])).attempt).toMatchObject({id,context});
    await expect(call('pe_update_review_access',[id,randomUUID(),false,null,false,null,null])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await call('pe_update_review_access',[id,owner,false,null,false,null,null]);
    await expect(call('pe_admin_review_case',[id])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await start(id);
    expect((await call('pe_owner_review_access',[id,owner])).shared).toBe(false);
    await call('pe_update_review_access',[id,owner,true,'pe-consultant-review-v1',false,null,null]);
    expect((await call('pe_owner_review_access',[id,owner])).shared).toBe(true);
  });
  it('pauses new starts in the database but preserves drafts and finalized results',async()=>{
    const id=randomUUID();await start(id);
    const dashboard=await call('pe_pilot_dashboard');
    await call('pe_set_pilot_state',['paused',dashboard.revision,actor]);
    await expect(start()).rejects.toThrow('PE_PILOT_PAUSED');
    await expect(call('pe_start_participant',[randomUUID(),owner,JSON.stringify(context),'pe-development-consent-v1','pe-personal-privacy-v1'])).rejects.toThrow('PE_PILOT_PAUSED');
    expect((await start(id)).id).toBe(id);
    await call('pe_write_participant',[id,owner,0,JSON.stringify(answers),randomUUID()]);
    expect((await call('pe_read_participant',[id,owner])).status).toBe('submitted');
    await expect(call('pe_set_pilot_state',['collecting',dashboard.revision,actor])).rejects.toThrow('PE_REVISION_CONFLICT');
    await call('pe_set_pilot_state',['collecting',Number(dashboard.revision)+1,actor]);
  });
  it('keeps evaluation opt-in separate from consultant access and suppresses small cohorts',async()=>{
    const dashboard=await call('pe_pilot_dashboard');expect(dashboard.areas).toEqual([]);
    expect(dashboard.evaluationSampleSize).toBe(0);
    const id=randomUUID();await start(id,owner,null);
    await call('pe_write_participant',[id,owner,0,JSON.stringify(answers),randomUUID()]);
    await call('pe_update_review_access',[id,owner,false,null,true,4,5]);
    expect((await call('pe_owner_review_access',[id,owner]))).toMatchObject({shared:false,evaluationConsent:true,clarity:4});
    await expect(call('pe_admin_review_case',[id])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    expect((await call('pe_pilot_dashboard')).evaluationSampleSize).toBe(1);
  });
  it('aggregates consenting participants, not retake counts; feedback and scores are separate',async()=>{
    for(let n=0;n<4;n++){
      const user=randomUUID(),id=randomUUID();await start(id,user);
      await call('pe_write_participant',[id,user,0,JSON.stringify(answers),randomUUID()]);
      await call('pe_update_review_access',[id,user,true,'pe-consultant-review-v1',true,4,5]);
    }
    const dashboard=await call('pe_pilot_dashboard');
    expect(dashboard.evaluationSampleSize).toBe(5);expect(dashboard.areas).toHaveLength(3);
    expect(dashboard.feedback).toMatchObject({count:5,clarityMean:4,usefulnessMean:5});
    expect(JSON.stringify(dashboard)).not.toMatch(/owner_id|email|responses|Synthetic role|scoring_key|option_scores/);
  });
  it('history is owner-bound, excludes expired attempts and has no answers or result details',async()=>{
    const history=await call('pe_owner_history',[owner]);
    expect(Array.isArray(history)).toBe(true);expect(JSON.stringify(history)).not.toMatch(/responses|context|result|owner/);
    expect(await call('pe_owner_history',[randomUUID()])).toEqual([]);
  });
  it('denies direct browser access and legacy service-role starts that would bypass pause',async()=>{
    for(const role of ['anon','authenticated']){
      expect((await db.query(`select has_function_privilege('${role}','pe_admin_review_case(uuid)','execute') as allowed`)).rows).toEqual([{allowed:false}]);
      expect((await db.query(`select has_table_privilege('${role}','pe_review_permissions','select,insert,update,delete') as allowed`)).rows).toEqual([{allowed:false}]);
    }
    expect((await db.query("select has_function_privilege('service_role','pe_start_participant(uuid,uuid,jsonb,text,text)','execute') as allowed")).rows).toEqual([{allowed:false}]);
    await db.exec('set role service_role');try{expect((await start()).status).toBe('draft');}finally{await db.exec('reset role');}
  });
  it('is idempotent and preserves review permissions and settings on migration replay',async()=>{
    const before=await call('pe_pilot_dashboard');await db.exec(migration);
    expect(await call('pe_pilot_dashboard')).toEqual(before);
  });
  it('erases review permission and feedback with owner-requested deletion',async()=>{
    const user=randomUUID(),id=randomUUID();await start(id,user);
    await call('pe_write_participant',[id,user,0,JSON.stringify(answers),randomUUID()]);
    await call('pe_update_review_access',[id,user,true,'pe-consultant-review-v1',true,4,5]);
    await call('pe_erase_participant',[id,user]);
    expect((await db.query('select count(*)::int as n from pe_review_permissions where attempt_id=$1',[id])).rows).toEqual([{n:0}]);
    expect((await db.query('select count(*)::int as n from pe_pilot_feedback where attempt_id=$1',[id])).rows).toEqual([{n:0}]);
    await expect(call('pe_admin_review_case',[id])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
  });
});
