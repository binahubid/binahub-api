import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
const db=new PGlite();
const migration=readFileSync('supabase/migrations/0070_sales_journey_hardening.sql','utf8');
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table leads(id uuid primary key default gen_random_uuid(),name text,email text unique,company text,phone text,source text,source_metadata jsonb,lifecycle_stage text default 'prospect',opportunity_stage text default 'identified',outreach_paused boolean default false,pipeline_updated_at timestamptz,last_meaningful_activity_at timestamptz);
    create table inquiries(id uuid primary key default gen_random_uuid(),lead_id uuid,name text,email text,message text,source text,module_request_data jsonb,created_at timestamptz default now(),follow_up_paused boolean default false,reply_sent_at timestamptz,follow_up_level int default 0,status text default 'Baru');
    create table assessments(id uuid primary key,lead_id uuid,form_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),follow_up_paused boolean default false,result_email_sent_at timestamptz,result_follow_up_level int default 0,proposal_sent_at timestamptz,proposal_follow_up_level int default 0,assessment_status text,proposal_status text,proposal_gate_status text,proposal_gate_reasons jsonb);
    create table email_suppressions(email text);create table calendar_bookings(attendee_email text,status text,lead_id uuid,assessment_id uuid);
    create table follow_up_events(lead_id uuid,target_type text,target_id uuid);
    create table follow_up_claims(target_type text,target_id uuid,channel text,level int);
    create table pe_participant_attempts(id uuid primary key,owner_id uuid,status text,retention_until timestamptz,context jsonb);
    create table pe_guest_contacts(attempt_id uuid primary key,name text,email text,draft_hash text);
    create table pe_review_permissions(attempt_id uuid,granted_at timestamptz,revoked_at timestamptz);`);
  await db.exec(migration);
});
afterAll(()=>db.close());
describe('sales journey SQL',()=>{
  it('advances only forward, including cold lead lifecycle, and preserves won/lost/client',async()=>{
    const id='11111111-1111-4111-8111-111111111111';
    await db.query('insert into leads(id) values($1)',[id]);
    await db.query("select advance_sales_stage_from_activity($1,'identified')",[id]);
    expect((await db.query<{lifecycle_stage:string}>('select lifecycle_stage from leads where id=$1',[id])).rows[0].lifecycle_stage).toBe('lead');
    for(const [life,stage] of [['lead','negotiation'],['client','won'],['retained','won'],['lead','lost']]){
      await db.query('update leads set lifecycle_stage=$2,opportunity_stage=$3 where id=$1',[id,life,stage]);
      for(const incoming of ['identified','qualified','consultation','proposal'])await db.query('select advance_sales_stage_from_activity($1,$2)',[id,incoming]);
      expect((await db.query('select lifecycle_stage,opportunity_stage from leads where id=$1',[id])).rows).toEqual([{lifecycle_stage:life,opportunity_stage:stage}]);
    }
  });
  it('finds newer due work behind 150 closed records and respects claims and suppressions',async()=>{
    await db.exec(`insert into inquiries(id,email,status,reply_sent_at) select md5(i::text)::uuid,'closed'||i||'@example.invalid','Closed',now()-interval '30 days' from generate_series(1,150) i;
      insert into inquiries(id,email,reply_sent_at) values('22222222-2222-4222-8222-222222222222','due@example.invalid',now()-interval '3 days');`);
    const read=async()=> (await db.query<{q:{inquiries:unknown[]}}>('select sales_due_followups(null,20) as q')).rows[0].q;
    expect((await read()).inquiries).toHaveLength(1);
    await db.exec("insert into email_suppressions values('due@example.invalid')");expect((await read()).inquiries).toEqual([]);
    await db.exec("delete from email_suppressions;insert into follow_up_claims values('inquiry','22222222-2222-4222-8222-222222222222','inquiry',1)");
    expect((await read()).inquiries).toEqual([]);
  });
  it('denies browser execution and supports safe replay',async()=>{
    await db.exec(migration);
    for(const role of ['anon','authenticated'])for(const fn of ['sales_due_followups(timestamptz,int)','advance_sales_stage_from_activity(uuid,text)'])
      expect((await db.query<{ok:boolean}>('select has_function_privilege($1,$2,\'execute\') as ok',[role,fn])).rows[0].ok).toBe(false);
  });
  it('surfaces stale proposal work for reconciliation without retrying ambiguous email delivery',async()=>{
    await db.exec(`insert into assessments(id,proposal_status,updated_at) values
      ('77777777-7777-4777-8777-777777777777','Sedang Disusun',now()-interval '11 minutes'),
      ('88888888-8888-4888-8888-888888888888','Sedang Disusun',now());`);
    expect((await db.query<{n:number}>('select flag_stalled_standard_proposals() n')).rows[0].n).toBe(1);
    expect((await db.query('select proposal_status from assessments where id=$1',['77777777-7777-4777-8777-777777777777'])).rows).toEqual([{proposal_status:'Perlu Rekonsiliasi'}]);
    expect((await db.query<{n:number}>('select flag_stalled_standard_proposals() n')).rows[0].n).toBe(0);
  });
  it('creates one consultation inquiry only with an authorized owner and current review consent',async()=>{
    const id='33333333-3333-4333-8333-333333333333',owner='44444444-4444-4444-8444-444444444444';
    await db.query("insert into pe_participant_attempts values($1,$2,'submitted',now()+interval '1 month','{\"role\":\"Manager\",\"goal\":\"Growth\"}')",[id,owner]);
    await db.query("insert into pe_guest_contacts(attempt_id,name,email,draft_hash) values($1,'Synthetic','individual@example.invalid','hash')",[id]);
    await expect(db.query('select pe_request_consultation($1,$2)',[id,owner])).rejects.toThrow('PE_CONSENT_REQUIRED');
    await db.query('insert into pe_review_permissions values($1,now(),null)',[id]);
    const request=()=>db.query<{r:unknown}>('select pe_request_consultation($1,$2) as r',[id,owner]);
    expect((await request()).rows).toEqual((await request()).rows);
    expect((await db.query<{n:number}>("select count(*)::int as n from inquiries where source='individual_consultation'")).rows[0].n).toBe(1);
    await expect(db.query('select pe_request_consultation($1,$2)',[id,'55555555-5555-4555-8555-555555555555'])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
  });
});
