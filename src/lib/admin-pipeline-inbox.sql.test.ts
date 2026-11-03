import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
const db=new PGlite();
type Lead={id:string;name:string;opportunityStage:string;qualificationProfile:object;nextActionDueAt:string|null};
type Inbox={records:Lead[];total:number;totalValue:number;counts:Record<string,number>;views:Record<string,number>;stages:Record<string,{total:number;value:number;valued:number}>;facets:{owners:string[];sources:string[]}};
type Detail={record:Lead;context:{activities:{leadId:string;id:string;note:string}[];activityTotal:number;historyPage:number;assessments:number;meetings:number;accountId:string|null}};
const read=async(args:unknown[]=[0,'','active','all','','','','priority',false])=>(await db.query<{value:Inbox}>('select admin_pipeline_inbox($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',args)).rows[0].value;
const detail=async(id:string,page=0)=>(await db.query<{value:Detail|null}>('select admin_pipeline_detail($1,$2) as value',[id,page])).rows[0].value;
beforeAll(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table leads(id uuid primary key,name text,email text,company text,industry text,location text,qualification_profile jsonb default '{}'::jsonb,phone text,source text,
    lead_score numeric,lead_status text,lead_temperature text,lead_score_confidence numeric,lifecycle_stage text,opportunity_stage text,opportunity_owner text,
    next_action text,next_action_due_at timestamptz,lead_time_zone text,opportunity_value numeric,lost_reason text,won_at timestamptz,lost_at timestamptz,
    outreach_paused boolean,outreach_pause_reason text,outreach_paused_at timestamptz,outreach_paused_by text,pipeline_updated_at timestamptz,created_at timestamptz default now());
   create table opportunity_activities(id uuid primary key,lead_id uuid,assessment_id uuid,inquiry_id uuid,event_type text,from_stage text,to_stage text,actor text,note text,created_at timestamptz default now());
   create table assessments(id uuid primary key,lead_id uuid);
   create table calendar_bookings(id uuid primary key,lead_id uuid,assessment_id uuid);
   create table client_accounts(id uuid primary key,source_lead_id uuid,created_at timestamptz default now());`);
  await db.exec(readFileSync('supabase/migrations/0085_admin_pipeline_inbox.sql','utf8'));
},30000);
beforeEach(()=>db.exec('truncate leads,opportunity_activities,assessments,calendar_bookings,client_accounts'));
afterAll(()=>db.close());
const add=async(extra:Record<string,unknown>={})=>{
  const id=randomUUID();await db.query(`insert into leads(id,name,email,company,source,opportunity_stage,opportunity_owner,next_action,next_action_due_at,opportunity_value,outreach_paused,lead_temperature,created_at,qualification_profile)
   values($1,$2,$3,'Synthetic Org',$4,$5,$6,$7,$8,$9,$10,$11,coalesce($12::timestamptz,now()),'{"private":"PRIVATE_QUALIFICATION"}')`,
   [id,extra.name??'Synthetic',extra.email??'test@company.invalid',extra.source??'website',extra.stage??'qualified',extra.owner??'admin@company.invalid',extra.action??'Confirm scope',extra.due??'2099-01-01',extra.value??100,extra.paused??false,extra.temperature??'warm',extra.created??null]);return id;
};
describe('SQL85 pipeline archive, isolated PostgreSQL',()=>{
  it('searches beyond1000 before pagination; stage totals and values include every result',async()=>{
    await db.exec(`insert into leads(id,name,email,source,opportunity_stage,opportunity_value,created_at)
     select gen_random_uuid(),'Synthetic '||i,'test@company.invalid','website','identified',10,now()-i*interval '1 minute' from generate_series(1,1005)i`);
    const old=await add({name:'Old %_* 東京',created:'2020-01-01',value:200});const full=await read();
    expect(full.total).toBe(1006);expect(full.records).toHaveLength(20);expect(full.totalValue).toBe(10250);expect(full.stages.identified.total).toBe(1005);expect(full.counts.all).toBe(1006);
    const found=await read([0,'%_* 東京','active','all','','','','newest',false]);expect(found.total).toBe(1);expect(found.records[0].id).toBe(old);
    expect(JSON.stringify(full)).not.toContain('PRIVATE_');expect((await detail(old))?.record.qualificationProfile).toEqual({private:'PRIVATE_QUALIFICATION'});
    expect((await read([50,'','active','all','','','','newest',false])).records).toHaveLength(6);
    expect((await read([51,'','active','all','','','','newest',false])).records).toHaveLength(0);
  });
  it('keeps known test exclusion, unknown-stage review, closed opportunities and null-stage defaults distinct',async()=>{
    await add({email:'probe@example.invalid'});await add({name:'Phase 13 Evidence'});await add({name:'phase14-check'});
    await add({stage:'won'});await add({stage:'lost'});await add({stage:'unrecognized'});await add();
    await db.query(`insert into leads(id,name,email,opportunity_stage) values($1,'Legacy','legacy@company.invalid',null)`,[randomUUID()]);
    expect(await read()).toMatchObject({total:2,views:{active:2,won:1,lost:1,review:1}});
    expect((await read([0,'','active','all','','','','priority',true])).total).toBe(5);
    expect((await read([0,'','review','all','','','','priority',false])).records[0].opportunityStage).toBe('unrecognized');
  });
  it('applies view, owner, source, stage and priority filters before stage aggregates; summary remains global',async()=>{
    await add({name:'Selected',owner:'owner@company.invalid',due:'2020-01-01',value:500,source:'manual_upload'});
    await add({owner:'different@company.invalid',stage:'consultation'});await add({owner:' ',action:' ',due:'2020-01-01',paused:true});
    expect(await read([0,'Selected','active','overdue','owner@company.invalid','manual_upload','qualified','value',false])).toMatchObject({total:1,totalValue:500,counts:{all:3,attention:2,overdue:2,unassigned:1,paused:1},stages:{qualified:{total:1,value:500}},facets:{sources:['manual_upload','website']}});
    expect((await read([0,'','active','unassigned','','','','priority',false])).total).toBe(1);
    expect((await read([0,'','active','paused','','','','priority',false])).total).toBe(1);
  });
  it('matches attention and priority rules without inferring AI status; supports deterministic sorting',async()=>{
    const healthy=await add({value:9999});const overdue=await add({due:'2020-01-01'});
    const missing=await add({action:' ',due:'2099-01-01',owner:' '});const fresh=await add({stage:'identified',action:' ',owner:'fresh@x.invalid'});
    expect((await read()).records.map(r=>r.id)).toEqual([missing,overdue,healthy,fresh]);
    expect((await read([0,'','active','attention','','','','priority',false])).total).toBe(2);
    expect((await read([0,'','active','all','','','','value',false])).records[0].id).toBe(healthy);
    const ids=[await add({name:'Tie',created:'2020-01-01'}),await add({name:'Tie',created:'2020-01-01'})].sort();
    expect((await read([0,'Tie','active','all','','','','newest',false])).records.map(r=>r.id)).toEqual(ids);
  });
  it.each(['A,B (HQ)','O\'Brien "Utama"','100%_unit*','a.b+[c](d)?{2}|^$','path\\branch','東京 Nusantara'])('searches %s literally',async(term)=>{
    const id=await add({name:term});await add();expect((await read([0,term,'active','all','','','','priority',false])).records.map(r=>r.id)).toEqual([id]);
  });
  it('paginates scoped history and counts linked records by ID, never by shared email',async()=>{
    const id=await add(),other=await add();const assessment=randomUUID(),account=randomUUID();
    await db.query('insert into assessments values($1,$2)',[assessment,id]);
    await db.query('insert into calendar_bookings values($1,null,$2),($3,$4,null)',[randomUUID(),assessment,randomUUID(),other]);
    await db.query('insert into client_accounts(id,source_lead_id) values($1,$2)',[account,id]);
    await db.query(`insert into opportunity_activities(id,lead_id,event_type,actor,note) select gen_random_uuid(),$1,'stage_changed','admin@x.invalid','History '||i from generate_series(1,25)i`,[id]);
    await db.query(`insert into opportunity_activities(id,lead_id,event_type,actor,note) values($1,$2,'created','admin@x.invalid','OTHER_PRIVATE_NOTE')`,[randomUUID(),other]);
    const first=await detail(id);expect(first?.context).toMatchObject({activityTotal:25,historyPage:0,assessments:1,meetings:1,accountId:account});expect(first?.context.activities).toHaveLength(20);
    const second=await detail(id,1);expect(second?.context.activities).toHaveLength(5);
    expect(new Set([...first!.context.activities,...second!.context.activities].map(a=>a.id)).size).toBe(25);
    expect(JSON.stringify(first)).not.toContain('OTHER_PRIVATE');expect(await detail(randomUUID())).toBeNull();
  });
  it('denies browser roles and validates bounds without writes',async()=>{
    for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await expect(read()).rejects.toThrow(/permission denied/i);await expect(detail(randomUUID())).rejects.toThrow(/permission denied/i);await db.exec('reset role');}
    await db.exec('set role service_role');expect((await read()).total).toBe(0);await db.exec('reset role');
    await expect(read([-1,'','active','all','','','','priority',false])).rejects.toThrow('PIPELINE_INBOX_INVALID');
    await expect(read([0,'','anything','all','','','','priority',false])).rejects.toThrow('PIPELINE_INBOX_INVALID');
    await expect(detail(randomUUID(),-1)).rejects.toThrow('PIPELINE_DETAIL_INVALID');
  });
});
