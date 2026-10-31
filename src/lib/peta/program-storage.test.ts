import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {syntheticPeta,syntheticHash as hash} from './synthetic';
import {keyHash} from '../../../scripts/lib/peta-source.mjs';
const db=new PGlite(),{pub,priv}=syntheticPeta();
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:unknown}>('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;
const admin=randomUUID(),outsider=randomUUID();
async function fixture(){
 const program=randomUUID(),participant=randomUUID(),actor=randomUUID(),access=randomUUID();
 await db.query("insert into engagements(id,title,code,status,end_date) values($1,'Synthetic program','SYNTHETIC','active',null)",[program]);
 await db.query("insert into participants values($1,'Synthetic participant')",[participant]);
 await db.query("insert into engagement_participants values($1,$2)",[program,participant]);
 await db.query("insert into app_client_access_codes values($1,$2,$3,$4,true,null)",[access,program,participant,actor]);
 await db.query("insert into program_modules values($1,'peta',true)",[program]);
 await call('peta_program_setup',[admin,program,'Approved internal reference',true]);
 return {program,participant,actor,access};
}
const args=(f:Awaited<ReturnType<typeof fixture>>)=>[f.actor,f.program,f.participant,f.access];
const open=(f:Awaited<ReturnType<typeof fixture>>,consent:string|null='peta-program-privacy-v1',review=true)=>call('peta_program_open',[...args(f),hash(randomUUID()),hash(randomUUID()),hash(randomUUID()),consent,review]) as Promise<{id:string;retentionUntil:string;reviewConsent:boolean;revision:number}>;
beforeAll(async()=>{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create table engagements(id uuid primary key,title text,code text,status text,end_date date);create table participants(id uuid primary key,name text);create table engagement_participants(engagement_id uuid,participant_id uuid);create table app_client_access_codes(id uuid primary key,program_id uuid,participant_id uuid,auth_user_id uuid,is_active boolean,expires_at timestamptz);create table program_modules(program_id uuid,module_key text check(module_key in ('tbos','lep','binainsight','pre_test','post_test')),enabled boolean);");
 await db.exec(readFileSync('supabase/migrations/0076_peta_invitation_pilot.sql','utf8'));
 // Synthetic envelope suffices for SQL lifecycle tests; no CEO/private source is loaded.
 await call('peta_install_source',[JSON.stringify(pub),JSON.stringify({algorithm:'A256GCM'}),keyHash(priv.optionToDimension),pub.contentSha256]);
 await db.exec(readFileSync('supabase/migrations/0077_peta_program_module.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0077_peta_program_module.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0078_peta_history_program_status.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0078_peta_history_program_status.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0079_peta_admin_team_access.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0079_peta_admin_team_access.sql','utf8'));
},30000);
afterAll(()=>db.close());
describe('PETA program integration SQL77',()=>{
 it('requires consent once, binds existing identity, and resumes without resetting retention or permissions',async()=>{
  const f=await fixture();expect(await call('peta_program_context',args(f))).toMatchObject({hasSession:false});
  await expect(open(f,null)).rejects.toThrow('PETA_CONSENT_REQUIRED');
  const first=await open(f,'peta-program-privacy-v1',false),again=await open(f,null,true);
  expect(again.id).toBe(first.id);expect(again.retentionUntil).toBe(first.retentionUntil);expect(again.reviewConsent).toBe(false);
  expect(await call('peta_program_context',args(f))).toMatchObject({hasSession:true,status:'in_progress'});
  const {rows}=await db.query('select * from peta_sessions where id=$1',[first.id]);expect(rows[0]).toMatchObject({program_id:f.program,participant_id:f.participant,program_access_id:f.access});
 });
 it('does not accept shared program ID or another participant as identity proof',async()=>{
  const f=await fixture();await expect(call('peta_program_context',[outsider,f.program,f.participant,f.access])).rejects.toThrow('PETA_NOT_FOUND');
  const other=await fixture();await expect(call('peta_program_context',[f.actor,f.program,other.participant,f.access])).rejects.toThrow('PETA_NOT_FOUND');
  await expect(call('peta_program_setup',[outsider,f.program,'Unapproved other owner',false])).rejects.toThrow('PETA_NOT_FOUND');
 });
 it('gates every credential on live membership, active access and enabled PETA',async()=>{
  const f=await fixture(),token=hash(randomUUID()),csrf=hash(randomUUID());
  await call('peta_program_open',[...args(f),token,csrf,hash(randomUUID()),'peta-program-privacy-v1',true]);
  expect(await call('peta_credential_scope',[token])).toEqual({programId:f.program,participantId:f.participant,accessId:f.access});
  await db.query("update program_modules set enabled=false where program_id=$1",[f.program]);
  await expect(call('peta_read_session',[token])).rejects.toThrow('PETA_SESSION_REQUIRED');
  await db.query("update program_modules set enabled=true where program_id=$1",[f.program]);
  await db.query("update app_client_access_codes set is_active=false where id=$1",[f.access]);
  await expect(call('peta_read_session',[token])).rejects.toThrow('PETA_SESSION_REQUIRED');
  await db.query("update app_client_access_codes set is_active=true where id=$1",[f.access]);
  await db.query("delete from engagement_participants where engagement_id=$1",[f.program]);
  await expect(call('peta_read_session',[token])).rejects.toThrow('PETA_SESSION_REQUIRED');
 });
 it('preserves finalized/revoked sessions and denies manual legacy invitations for a program',async()=>{
  const f=await fixture(),s=await open(f),w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  await expect(call('peta_legacy_invitation_create',[admin,w,hash(randomUUID()),'SYNTHETIC'])).rejects.toThrow('PETA_NOT_FOUND');
  await expect(call('peta_program_admin_action',[admin,s.id,'recover',hash(randomUUID()),true])).rejects.toThrow('PETA_INVALID_REQUEST');
  await call('peta_program_admin_action',[admin,s.id,'revoke',null,false]);await expect(open(f)).rejects.toThrow('PETA_FINALIZED');
 });
 it('retains legacy pilot sessions and does not turn program code into result credentials',async()=>{
  const w=await call('peta_workspace_create',[admin,'Legacy synthetic','Approved legacy policy',false]),invite=hash(randomUUID()),token=hash(randomUUID()),csrf=hash(randomUUID());
  await call('peta_legacy_invitation_create',[admin,w,invite,'LEGACY']);await call('peta_redeem',[invite,token,csrf,'peta-privacy-v1',false]);
  expect(await call('peta_credential_scope',[token])).toEqual({programId:null,participantId:null,accessId:null});
  expect(await call('peta_read_session',[token])).toMatchObject({participantCode:'LEGACY'});
  await expect(call('peta_read_result',[hash('SYNTHETIC')])).rejects.toThrow('PETA_SESSION_REQUIRED');
 });
 it('keeps SQL helpers and raw tables inaccessible to participant database roles',async()=>{
  const rows=(await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.peta_program_open(uuid,uuid,uuid,uuid,text,text,text,text,boolean)','execute') as allowed")).rows;expect(rows[0].allowed).toBe(false);
  const f=await fixture();await open(f);
  const dash=await call('peta_program_dashboard',[admin]) as {sessions:{programId:string;participantName:string}[]};
  expect(dash.sessions).toContainEqual(expect.objectContaining({programId:f.program,participantName:'Synthetic participant'}));
  expect((await call('peta_program_dashboard',[outsider]) as {sessions:unknown[]}).sessions).toHaveLength(0);
 });
});

describe('SQL78 PETA active programs and retained history',()=>{
 const dashboard=(actor=admin,workspace:string|null=null,scope='active',page=0,search='',status='all')=>call('peta_management_dashboard',[actor,workspace,scope,page,search,status]) as Promise<{programs:{id:string}[];sessions:{id:string;canReadResult:boolean}[];total:number;counts:{total:number}} >;
 it('lets the assigned, permitted admin read the same final result after the program ends',async()=>{
  const f=await fixture(),token=hash(randomUUID()),csrf=hash(randomUUID());
  const s=await call('peta_program_open',[...args(f),token,csrf,hash(randomUUID()),'peta-program-privacy-v1',true]) as {id:string;workspaceId:string};
  for(let i=0;i<24;i++)await call('peta_save_answer',[token,csrf,i,pub.blocks[i].id,'A','B']);
  await call('peta_submit',[token,csrf,24,hash(randomUUID()),JSON.stringify(priv.optionToDimension)]);
  const before=await call('peta_program_admin_action',[admin,s.id,'result',null,false]);
  await db.query("update engagements set status='completed' where id=$1",[f.program]);
  expect(await call('peta_program_admin_action',[admin,s.id,'result',null,false])).toEqual(before);
  expect((await dashboard(admin,null,'history')).sessions).toContainEqual(expect.objectContaining({id:s.id,canReadResult:true}));
  expect((await db.query<{count:number}>('select count(*)::int count from peta_answers where session_id=$1',[s.id])).rows[0].count).toBe(24);
  await expect(call('peta_program_admin_action',[outsider,s.id,'result',null,false])).rejects.toThrow('PETA_NOT_FOUND');
 });
 it('moves ended programs to history without erasing participants, answers or consent',async()=>{
  const f=await fixture(),s=await open(f,'peta-program-privacy-v1',false);
  const w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  expect((await dashboard(admin,w)).sessions).toContainEqual(expect.objectContaining({id:s.id}));
  await db.query("update engagements set status='completed' where id=$1",[f.program]);
  const active=await dashboard(admin,w),history=await dashboard(admin,w,'history');
  expect(active.programs.some(p=>p.id===f.program)).toBe(false);expect(active.total).toBe(0);
  expect(history.total).toBe(1);expect(history.sessions[0]).toMatchObject({id:s.id,canReadResult:false});
  expect((await db.query('select review_consent from peta_sessions where id=$1',[s.id])).rows).toEqual([{review_consent:false}]);
  await expect(call('peta_program_context',args(f))).rejects.toThrow('PETA_NOT_FOUND');
 });
 it('excludes disabled modules and expired schedules from the active picker but keeps history',async()=>{
  const f=await fixture();await open(f);await db.query("update program_modules set enabled=false where program_id=$1",[f.program]);
  expect((await dashboard()).programs.some(p=>p.id===f.program)).toBe(false);
  await db.query("update program_modules set enabled=true where program_id=$1",[f.program]);
  await db.query("update engagements set end_date=current_date-2 where id=$1",[f.program]);
  const w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  expect((await dashboard(admin,w,'history')).total).toBe(1);
  await expect(dashboard(outsider,w,'history')).rejects.toThrow('PETA_NOT_FOUND');
  expect((await dashboard(outsider)).sessions).toHaveLength(0);
 });
 it('paginates and searches older records beyond the former global 100-row cap',async()=>{
  const w=await call('peta_workspace_create',[admin,'History pagination','Approved synthetic policy',false]) as string;
  await db.query(`with invites as (
   insert into peta_invitations(workspace_id,token_hash,participant_code,expires_at)
   select $1,md5('page-'||i)||md5('hash-'||i),'PAGE-'||lpad(i::text,3,'0'),now()+interval '1 day' from generate_series(1,125) i returning id,workspace_id,participant_code)
   insert into peta_sessions(workspace_id,invitation_id,participant_code,consent_version,privacy_reference,created_at)
   select workspace_id,id,participant_code,'synthetic','Synthetic approved policy',now()-(substring(participant_code from 6)::int)*interval '1 minute' from invites`,[w]);
  const first=await dashboard(admin,w,'history'),last=await dashboard(admin,w,'history',6);
  expect(first.total).toBe(125);expect(first.counts.total).toBe(125);expect(first.sessions).toHaveLength(20);expect(last.sessions).toHaveLength(5);
  expect((await dashboard(admin,w,'history',0,'PAGE-125')).total).toBe(1);
  expect((await dashboard(admin,w,'history',0,'%')).total).toBe(0);
  expect((await dashboard(admin,w,'history',0,'','submitted')).total).toBe(0);
  expect(first.sessions.every(s=>!s.canReadResult)).toBe(true);
  expect((await db.query<{allowed:boolean}>("select has_function_privilege('authenticated','public.peta_management_dashboard(uuid,uuid,text,integer,text,text)','execute') as allowed")).rows[0].allowed).toBe(false);
 });
});

describe('SQL79 shared PETA administration',()=>{
 const secondAdmin=randomUUID();
 const dashboard=(workspace:string,actor=secondAdmin,scope='active')=>call('peta_team_dashboard',[actor,workspace,scope]) as Promise<{workspaces:{id:string}[];sessions:{id:string;canReadResult:boolean}[];counts:{total:number;inProgress:number;submitted:number};total:number}>;
 async function finish(f:Awaited<ReturnType<typeof fixture>>,review=true){
  const token=hash(randomUUID()),csrf=hash(randomUUID());
  const session=await call('peta_program_open',[...args(f),token,csrf,hash(randomUUID()),'peta-program-privacy-v1',review]) as {id:string};
  for(let i=0;i<24;i++)await call('peta_save_answer',[token,csrf,i,pub.blocks[i].id,'A','B']);
  await call('peta_submit',[token,csrf,24,hash(randomUUID()),JSON.stringify(priv.optionToDimension)]);
  return session;
 }
 it('shows the same four started participants to both admins without transferring ownership',async()=>{
  const f=await fixture(),first=await open(f),w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  for(let i=0;i<3;i++){
   const next={...f,participant:randomUUID(),actor:randomUUID(),access:randomUUID()};
   await db.query("insert into participants values($1,'Additional synthetic participant')",[next.participant]);
   await db.query('insert into engagement_participants values($1,$2)',[f.program,next.participant]);
   await db.query('insert into app_client_access_codes values($1,$2,$3,$4,true,null)',[next.access,f.program,next.participant,next.actor]);
   await open(next);
  }
  const creator=await dashboard(w,admin),other=await dashboard(w);
  expect(other).toEqual(creator);expect(other.counts).toEqual({total:4,inProgress:4,submitted:0});
  expect(other.workspaces).toContainEqual(expect.objectContaining({id:w}));
  expect(other.sessions).toContainEqual(expect.objectContaining({id:first.id,canReadResult:false}));
  expect((await db.query('select owner_id from peta_workspaces where id=$1',[w])).rows[0]).toEqual({owner_id:admin});
 });
 it('lets another admin update setup while preserving participant consent, retention and creator provenance',async()=>{
  const f=await fixture(),s=await open(f,'peta-program-privacy-v1',false);
  const before=(await db.query('select * from peta_sessions where id=$1',[s.id])).rows[0];
  const w=await call('peta_team_program_setup',[secondAdmin,f.program,'Updated internal policy reference',true]);
  expect((await db.query('select owner_id,consultant_id from peta_workspaces where id=$1',[w])).rows[0]).toEqual({owner_id:admin,consultant_id:admin});
  expect((await db.query('select * from peta_sessions where id=$1',[s.id])).rows[0]).toEqual(before);
  expect((await db.query('select actor_id from peta_access_audit where workspace_id=$1 and event=\'program_configured\' order by id desc limit 1',[w])).rows[0]).toEqual({actor_id:secondAdmin});
 });
 it('lets both admins read a consented report and records the real reader, including after program completion',async()=>{
  const f=await fixture(),s=await finish(f),w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  const original=await call('peta_team_session_action',[admin,s.id,'result']);
  expect(await call('peta_team_session_action',[secondAdmin,s.id,'result'])).toEqual(original);
  expect((await dashboard(w)).sessions).toContainEqual(expect.objectContaining({id:s.id,canReadResult:true}));
  await db.query("update engagements set status='completed' where id=$1",[f.program]);
  expect((await dashboard(w,secondAdmin,'history')).sessions).toContainEqual(expect.objectContaining({id:s.id,canReadResult:true}));
  expect(await call('peta_team_session_action',[secondAdmin,s.id,'result'])).toEqual(original);
  const readers=(await db.query<{actor_id:string}>('select distinct actor_id from peta_access_audit where session_id=$1 and event=\'consultant_result_opened\'',[s.id])).rows.map(row=>row.actor_id);
  expect(readers).toEqual(expect.arrayContaining([admin,secondAdmin]));
 });
 it('does not turn declined consent into report access for any admin or allow expired/revoked reports',async()=>{
  const f=await fixture(),s=await finish(f,false),w=(await db.query<{id:string}>('select id from peta_workspaces where program_id=$1',[f.program])).rows[0].id;
  for(const actor of [admin,secondAdmin]){
   expect((await dashboard(w,actor)).sessions[0].canReadResult).toBe(false);
   await expect(call('peta_team_session_action',[actor,s.id,'result'])).rejects.toThrow('PETA_NOT_FOUND');
  }
  expect((await db.query('select review_consent from peta_sessions where id=$1',[s.id])).rows[0]).toEqual({review_consent:false});
  const allowed=await fixture(),a=await finish(allowed);
  await db.query("update peta_sessions set retention_until=now()-interval '1 minute' where id=$1",[a.id]);
  await expect(call('peta_team_session_action',[secondAdmin,a.id,'result'])).rejects.toThrow('PETA_NOT_FOUND');
  const revoked=await fixture(),r=await finish(revoked);
  await call('peta_team_session_action',[secondAdmin,r.id,'revoke']);
  await expect(call('peta_team_session_action',[admin,r.id,'result'])).rejects.toThrow('PETA_NOT_FOUND');
 });
 it('keeps team RPCs and raw participant tables inaccessible to browser roles',async()=>{
  const functions=['peta_team_dashboard(uuid,uuid,text,integer,text,text)','peta_team_program_setup(uuid,uuid,text,boolean)','peta_team_session_action(uuid,uuid,text,text,boolean)','peta_team_invitation_create(uuid,uuid,text,text)','peta_team_invitation_revoke(uuid,uuid)'];
  for(const name of functions)for(const role of ['anon','authenticated']){
   expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'execute\') as allowed',[role,'public.'+name])).rows[0].allowed).toBe(false);
  }
  await expect(call('peta_team_dashboard',[null])).rejects.toThrow('PETA_INVALID_REQUEST');
  await expect(call('peta_team_session_action',[null,randomUUID(),'result'])).rejects.toThrow('PETA_NOT_FOUND');
  expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','public.peta_results','select') as allowed")).rows[0].allowed).toBe(false);
 });
 it('lets another admin manage legacy invitations without impersonating their creator',async()=>{
  const w=await call('peta_workspace_create',[admin,'Legacy team fixture','Approved synthetic policy',true]);
  const invitation=await call('peta_team_invitation_create',[secondAdmin,w,hash(randomUUID()),'LEGACY-TEAM']) as {id:string};
  expect(await call('peta_team_invitation_revoke',[secondAdmin,invitation.id])).toBe(true);
  expect((await db.query('select actor_id from peta_access_audit where workspace_id=$1 and event=\'invitation_revoked\'',[w])).rows[0]).toEqual({actor_id:secondAdmin});
  const f=await fixture(),s=await open(f);
  await expect(call('peta_team_session_action',[secondAdmin,s.id,'recover',hash(randomUUID()),true])).rejects.toThrow('PETA_INVALID_REQUEST');
  await expect(call('peta_team_session_action',[secondAdmin,s.id,'erase',null,false])).rejects.toThrow('PETA_INVALID_REQUEST');
  expect((await db.query('select id from peta_sessions where id=$1',[s.id])).rows).toHaveLength(1);
 });
});
