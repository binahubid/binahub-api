import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import catalog from '@/data/competency-catalog-2026.json';
import {preparePEDeployment} from '../../../scripts/prepare-pe-deployment.mjs';
import {makeSyntheticPEInstrument} from './synthetic-fixture';
import {readPEInstrument} from './definition';
import {PEDeliveryAttemptSchema} from './delivery-contracts';
import {buildPEReport} from './report';
const db=new PGlite(),instrument=readPEInstrument(makeSyntheticPEInstrument());
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:unknown}>(`select ${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as value`,args)).rows[0].value;
const context={role:'Synthetic',goal:'Synthetic development',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}};
const answers=Object.fromEntries([...instrument.config.self_report_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,4]),...instrument.config.sjt_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,'A'])]);
async function submit(){const id=randomUUID(),draft=hash(id),linkId=randomUUID(),token=hash(linkId);
 const start=await call('pe_start_guest',[id,draft,'Synthetic','person@example.invalid',JSON.stringify(context),'pe-development-consent-v1','pe-personal-privacy-v1','pe-consultant-review-v1','direct']) as {ownerId:string};
 const attempt=PEDeliveryAttemptSchema.parse(await call('pe_write_participant',[id,start.ownerId,0,JSON.stringify(answers),'synthetic_submission_01']));
 await call('pe_queue_guest_report',[id,draft,JSON.stringify(buildPEReport(attempt,instrument)),linkId,token]);
 return {id,draft,linkId,token,attempt};
}
let legacy:Awaited<ReturnType<typeof submit>>;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,is_mock boolean default false,catalog_version text default 'signature-2026-ceo-v1',base_price numeric default 25000000,metadata jsonb default '{}');`);
 for(const item of catalog.solutions)await db.query('insert into catalog_modules(module_code) values($1)',[item.moduleCode]);
 await db.exec(readFileSync('supabase/migrations/0063_competency_dictionary.sql','utf8'));
 await db.exec(preparePEDeployment(instrument,readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8')));
 for(const f of ['0065_personal_effectiveness_delivery.sql','0066_personal_effectiveness_review_pilot.sql','0067_personal_effectiveness_guest_reports.sql'])await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
 legacy=await submit();
 await db.exec(readFileSync('supabase/migrations/0074_personal_free_access_48h.sql','utf8'));
},30000);
afterAll(()=>db.close());
describe('new free result access policy',()=>{
 it('does not shorten previous submissions and survives reapplication',async()=>{
  await db.exec(readFileSync('supabase/migrations/0074_personal_free_access_48h.sql','utf8'));
  const row=(await db.query<{retention_until:Date;access_policy:string|null}>('select retention_until,access_policy from pe_participant_attempts where id=$1',[legacy.id])).rows[0];
  expect(row.access_policy).toBeNull();expect(new Date(row.retention_until).getTime()).toBe(Date.parse(legacy.attempt.retentionUntil));
 });
 it('caps new results at 48h and supports reopen only within the original 30m window',async()=>{
  const s=await submit();expect(Date.parse(s.attempt.retentionUntil)-Date.parse(s.attempt.submittedAt!)).toBe(48*3600000);
  await call('pe_claim_report_email',[s.id]);
  expect(await call('pe_exchange_email_link',[s.id,s.token,hash('session-a')])).toBe(true);
  await db.query("update pe_email_links set consumed_at=now()-interval '29 minutes' where id=$1",[s.linkId]);
  expect(await call('pe_exchange_email_link',[s.id,s.token,hash('session-b')])).toBe(true);
  const remaining=(await db.query<{seconds:number}>("select extract(epoch from expires_at-now())::int seconds from pe_result_sessions where token_hash=$1",[hash('session-b')])).rows[0].seconds;
  expect(remaining).toBeLessThanOrEqual(60);expect(remaining).toBeGreaterThan(0);
  await db.query("update pe_email_links set consumed_at=now()-interval '31 minutes' where id=$1",[s.linkId]);
  await expect(call('pe_exchange_email_link',[s.id,s.token,hash('session-c')])).rejects.toThrow('PE_LINK_EXPIRED');
  await db.query("update pe_report_email_jobs set created_at=now()-interval '11 minutes' where attempt_id=$1",[s.id]);
  expect(await call('pe_request_result_link',[s.id,'person@example.invalid',randomUUID(),hash('replacement')])).toBe(true);
 });
 it('denies recovery after expiry and cleans only expired new free results',async()=>{
  const s=await submit();await call('pe_claim_report_email',[s.id]);
  await db.query("update pe_participant_attempts set retention_until=now()-interval '1 minute' where id=$1",[s.id]);
  expect(await call('pe_request_result_link',[s.id,'person@example.invalid',randomUUID(),hash('expired')])).toBe(false);
  await expect(call('pe_exchange_email_link',[s.id,s.token,hash('expired-session')])).rejects.toThrow('PE_LINK_EXPIRED');
  await call('pe_cleanup_result_sessions');
  expect((await db.query('select id from pe_participant_attempts where id=$1',[s.id])).rows).toHaveLength(0);
  expect((await db.query('select attempt_id from pe_report_snapshots where attempt_id=$1',[s.id])).rows).toHaveLength(0);
  expect((await db.query('select id from pe_participant_attempts where id=$1',[legacy.id])).rows).toHaveLength(1);
 });
});
