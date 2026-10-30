import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {syntheticPeta,syntheticHash as hash} from './synthetic';
const db=new PGlite(),{pub}=syntheticPeta();
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:unknown}>('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;
const admin=randomUUID(),outsider=randomUUID();
async function fixture(){
 const program=randomUUID(),participant=randomUUID(),actor=randomUUID(),access=randomUUID();
 await db.query("insert into engagements values($1,'Synthetic program','SYNTHETIC','active',null)",[program]);
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
 await call('peta_install_source',[JSON.stringify(pub),JSON.stringify({algorithm:'A256GCM'}),'a'.repeat(64),pub.contentSha256]);
 await db.exec(readFileSync('supabase/migrations/0077_peta_program_module.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/0077_peta_program_module.sql','utf8'));
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
