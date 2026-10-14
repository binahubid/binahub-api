import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only',()=>({}));
import catalog from '@/data/competency-catalog-2026.json';
import { preparePEDeployment } from '../../../scripts/prepare-pe-deployment.mjs';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { readPEInstrument } from './definition';
import { buildPEReport } from './report';
import { PEDeliveryAttemptSchema } from './delivery-contracts';
const db=new PGlite(),instrument=readPEInstrument(makeSyntheticPEInstrument());
const context={role:'Synthetic role',goal:'Synthetic goal',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}};
const answers=Object.fromEntries([...instrument.config.self_report_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,4]),
  ...instrument.config.sjt_items.filter(i=>['PE-02','PE-04','PE-06'].includes(i.competency_code)).map(i=>[i.id,'A'])]);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:unknown}>(`select ${name}(${args.map((_,index)=>'$'+(index+1)).join(',')}) as value`,args)).rows[0].value;
async function start(email='person@example.invalid'){const id=randomUUID(),draftHash=hash(randomUUID());
  const envelope=await call('pe_start_guest',[id,draftHash,'Synthetic name',email,JSON.stringify(context),
    'pe-development-consent-v1','pe-personal-privacy-v1','pe-consultant-review-v1','email']) as {ownerId:string;attempt:unknown};
  return {id,draftHash,...envelope};}
async function submit(email='person@example.invalid'){const guest=await start(email);const attempt=PEDeliveryAttemptSchema.parse(await call('pe_write_participant',[guest.id,guest.ownerId,0,JSON.stringify(answers),'synthetic_submit_001']));
  const snapshot=buildPEReport(attempt,instrument),linkId=randomUUID(),linkHash=hash(randomUUID());
  await call('pe_queue_guest_report',[guest.id,guest.draftHash,JSON.stringify(snapshot),linkId,linkHash]);
  return {...guest,attempt,snapshot,linkId,linkHash};}
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,is_mock boolean default false,
    catalog_version text default 'signature-2026-ceo-v1',base_price numeric default 25000000,metadata jsonb default '{}');`);
  for(const item of catalog.solutions)await db.query('insert into catalog_modules(module_code) values($1)',[item.moduleCode]);
  await db.exec(readFileSync('supabase/migrations/0063_competency_dictionary.sql','utf8'));
  await db.exec(preparePEDeployment(instrument,readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8')));
  for(const file of ['0065_personal_effectiveness_delivery.sql','0066_personal_effectiveness_review_pilot.sql','0067_personal_effectiveness_guest_reports.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
},30_000);
afterAll(()=>db.close());
describe('guest diagnosis, frozen reports, and durable email',()=>{
  it('starts without an auth account, binds one attempt, and retries without duplicate contacts',async()=>{
    const guest=await start();expect((guest.attempt as {result:unknown}).result).toBeNull();
    const replay=await call('pe_start_guest',[guest.id,guest.draftHash,'Synthetic name','person@example.invalid',JSON.stringify(context),
      'pe-development-consent-v1','pe-personal-privacy-v1','pe-consultant-review-v1','email']);
    expect(replay).toMatchObject({ownerId:guest.ownerId,attempt:guest.attempt});
  });
  it('denies guessed IDs/hashes and never exposes a submitted result to a draft capability',async()=>{
    const guest=await submit();
    await expect(call('pe_guest_attempt',[guest.id,hash('wrong'),'draft'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    const view=await call('pe_guest_attempt',[guest.id,guest.draftHash,'draft']) as {attempt:{result:unknown};report:unknown};
    expect(view.attempt.result).toBeNull();expect(view.report).toBeNull();
    await expect(call('pe_guest_attempt',[guest.id,guest.draftHash,'result'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
  });
  it('freezes the report once and rejects fabricated scores before the first snapshot',async()=>{
    const guest=await start();const attempt=PEDeliveryAttemptSchema.parse(await call('pe_write_participant',[guest.id,guest.ownerId,0,JSON.stringify(answers),'synthetic_submit_001']));
    const report=buildPEReport(attempt,instrument);report.areas[0].selfReport.score=99;
    await expect(call('pe_freeze_report',[guest.id,guest.ownerId,JSON.stringify(report)])).rejects.toThrow('PE_INVALID_REPORT');
    const valid=buildPEReport(attempt,instrument);
    expect(await call('pe_freeze_report',[guest.id,guest.ownerId,JSON.stringify(valid)])).toEqual(valid);
    expect(await call('pe_freeze_report',[guest.id,guest.ownerId,JSON.stringify(report)])).toEqual(valid);
  });
  it('queues once, leases exclusively, retries with the same link/job, and does not resend a completed job',async()=>{
    const guest=await submit();
    await call('pe_queue_guest_report',[guest.id,guest.draftHash,JSON.stringify(guest.snapshot),randomUUID(),hash('unused')]);
    const job=await call('pe_claim_report_email',[guest.id]) as {id:string;leaseToken:string};expect(job.id).toBe(guest.linkId);
    expect(await call('pe_claim_report_email',[guest.id])).toBeNull();
    expect(await call('pe_finish_report_email',[job.id,randomUUID(),'provider-id',null])).toBe(false);
    expect(await call('pe_finish_report_email',[job.id,job.leaseToken,'provider-id',null])).toBe(true);
    expect(await call('pe_claim_report_email',[guest.id])).toBeNull();
  });
  it('requires a live single-use emailed link and restricts the result session to its attempt',async()=>{
    const guest=await submit();await call('pe_claim_report_email',[guest.id]);const session=hash(randomUUID());
    expect(await call('pe_exchange_email_link',[guest.id,guest.linkHash,session])).toBe(true);
    const result=await call('pe_guest_attempt',[guest.id,session,'result']) as {report:unknown};expect(result.report).toEqual(guest.snapshot);
    await expect(call('pe_exchange_email_link',[guest.id,guest.linkHash,hash('another')])).rejects.toThrow('PE_LINK_EXPIRED');
    await expect(call('pe_guest_attempt',[randomUUID(),session,'result'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await db.query('update pe_result_sessions set expires_at=now()-interval \'1 minute\' where token_hash=$1',[session]);
    await expect(call('pe_guest_attempt',[guest.id,session,'result'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
  });
  it('recovers a crashed last attempt with a stable sender/origin inside the dedup window',async()=>{
    const guest=await submit();await call('pe_claim_report_email',[guest.id,'sender@example.invalid','https://app.example.invalid']);
    await db.query("update pe_report_email_jobs set attempts=5,lease_until=now()-interval '1 minute' where attempt_id=$1",[guest.id]);
    const retry=await call('pe_claim_report_email',[guest.id,'changed@example.invalid','https://changed.example.invalid']) as {id:string;from:string;origin:string;leaseToken:string};
    expect(retry).toMatchObject({id:guest.linkId,from:'sender@example.invalid',origin:'https://app.example.invalid'});
    expect(await call('pe_finish_report_email',[retry.id,retry.leaseToken,'accepted',null])).toBe(true);
  });
  it('does not reset existing drafts, permissions or immutable snapshots when reapplied',async()=>{
    const guest=await submit();await db.exec(readFileSync('supabase/migrations/0067_personal_effectiveness_guest_reports.sql','utf8'));
    expect((await call('pe_guest_attempt',[guest.id,guest.draftHash,'draft']) as {attempt:{status:string}}).attempt.status).toBe('submitted');
  });
  it('recovers scoring committed before queue insertion, even beyond draft access',async()=>{
    // Earlier freeze tests intentionally left a submitted report without an email job.
    for(let n=0;n<10;n++){
      const pending=await call('pe_next_unqueued_report') as {attempt:unknown;draftHash:string}|null;if(!pending)break;
      const stored=PEDeliveryAttemptSchema.parse(pending.attempt);
      await call('pe_queue_guest_report',[stored.id,pending.draftHash,JSON.stringify(buildPEReport(stored,instrument)),randomUUID(),hash(randomUUID())]);
    }
    const guest=await start();const attempt=PEDeliveryAttemptSchema.parse(await call('pe_write_participant',[guest.id,guest.ownerId,0,JSON.stringify(answers),'synthetic_submit_001']));
    await db.query("update pe_guest_contacts set draft_until=now()-interval '1 minute' where attempt_id=$1",[guest.id]);
    await expect(call('pe_guest_attempt',[guest.id,guest.draftHash,'draft'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    const repair=await call('pe_next_unqueued_report') as {attempt:{id:string};draftHash:string};expect(repair.attempt.id).toBe(guest.id);
    await call('pe_queue_guest_report',[guest.id,guest.draftHash,JSON.stringify(buildPEReport(attempt,instrument)),randomUUID(),hash('recovered')]);
    expect(await call('pe_next_unqueued_report')).toBeNull();
  });
  it('does not blindly retry past the provider deduplication window',async()=>{
    const guest=await submit();await call('pe_claim_report_email',[guest.id]);
    await db.query("update pe_report_email_jobs set first_attempt_at=now()-interval '21 hours',lease_until=now()-interval '1 minute' where attempt_id=$1",[guest.id]);
    expect(await call('pe_claim_report_email',[guest.id])).toBeNull();
    expect((await db.query<{status:string}>('select status from pe_report_email_jobs where attempt_id=$1',[guest.id])).rows[0].status).toBe('uncertain');
  });
  it('requests a private email link without needing an account or attempt number, and limits repeat requests',async()=>{
    const guest=await submit('recovery@example.invalid');
    expect(await call('pe_request_latest_result_link',['unknown@example.invalid',randomUUID(),hash('unknown')])).toBeNull();
    expect(await call('pe_request_latest_result_link',['recovery@example.invalid',randomUUID(),hash('too soon')])).toBeNull();
    await db.query("update pe_report_email_jobs set created_at=now()-interval '11 minutes' where attempt_id=$1",[guest.id]);
    expect(await call('pe_request_latest_result_link',['recovery@example.invalid',randomUUID(),hash('reissue')])).toBe(guest.id);
    expect(await call('pe_request_latest_result_link',['recovery@example.invalid',randomUUID(),hash('reissue2')])).toBeNull();
    expect((await db.query('select count(*)::int n from pe_report_email_jobs where attempt_id=$1',[guest.id])).rows).toEqual([{n:2}]);
  });
  it('requires fresh export consent, excludes identities, and respects revocation',async()=>{
    const participants=await Promise.all(Array.from({length:5},()=>submit()));
    for(const guest of participants)await call('pe_update_review_access',[guest.id,guest.ownerId,true,'pe-consultant-review-v1',true,4,4]);
    await expect(call('pe_export_evaluation',[randomUUID()])).rejects.toThrow('PE_EVALUATION_SAMPLE_SMALL');
    for(const guest of participants)await call('pe_update_review_access_v2',[guest.id,guest.ownerId,false,null,true,4,4,'pe-evaluation-v2']);
    const rows=await call('pe_export_evaluation',[randomUUID()]) as object[];expect(rows).toHaveLength(5);
    expect(JSON.stringify(rows)).not.toMatch(/Synthetic goal|Synthetic role|example.invalid|ownerId|attemptId|token|scoring_key|rationale/);
    const guest=participants[0];await call('pe_update_review_access_v2',[guest.id,guest.ownerId,false,null,false,null,null,'pe-evaluation-v2']);
    await expect(call('pe_export_evaluation',[randomUUID()])).rejects.toThrow('PE_EVALUATION_SAMPLE_SMALL');
    await call('pe_update_review_access',[guest.id,guest.ownerId,false,null,true,4,4]);
    await expect(call('pe_export_evaluation',[randomUUID()])).rejects.toThrow('PE_EVALUATION_SAMPLE_SMALL');
  });
  it('denies browser roles the tables/RPCs and erases linked guest/session/report/email data with the attempt',async()=>{
    const guest=await submit();
    await db.exec('set role anon');await expect(call('pe_guest_attempt',[guest.id,guest.draftHash,'draft'])).rejects.toThrow(/permission denied/);
    await db.exec('reset role');await call('pe_erase_participant',[guest.id,guest.ownerId]);
    for(const table of ['pe_guest_contacts','pe_report_snapshots','pe_email_links','pe_report_email_jobs']) {
      expect((await db.query<{count:number}>('select count(*)::int count from '+table+' where attempt_id=$1',[guest.id])).rows[0].count).toBe(0);
    }
  });
});
