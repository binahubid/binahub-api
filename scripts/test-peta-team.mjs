// Offline integration check. Synthetic statements, identities and mappings only.
// Run inside the documented no-network/container sandbox, never against Supabase.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import Module, {createRequire} from 'node:module';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

const db=new PGlite();
const hash=value=>createHash('sha256').update(value).digest('hex');
const call=async(name,args=[])=> (await db.query('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;
const adminA=randomUUID(),adminB=randomUUID();
const permutations=text=>text.length===1?[text]:[...text].flatMap((letter,i)=>permutations(text.slice(0,i)+text.slice(i+1)).map(rest=>letter+rest));
const patterns=permutations('DISC');
const blocks=patterns.map((_,i)=>({id:'PETA-Q'+String(i+1).padStart(2,'0'),order:i+1,context:'Synthetic situation '+(i+1),options:[...'ABCD'].map(code=>({id:'synthetic-'+i+'-'+code,code,text:'Koordinasi antartim.'}))}));
const pub={instrumentId:'PETA-DISC-FC24',version:'1.0.0-pilot',blockCount:24,blocks,contentSha256:hash('synthetic public payload')};
const mapping=Object.fromEntries(blocks.map((block,i)=>[block.id,Object.fromEntries([...'ABCD'].map((code,j)=>[code,patterns[i][j]]))]));
const fingerprint=hash(Object.entries(mapping).map(([id,value])=>id+':'+[...'ABCD'].map(code=>value[code]).join('')).join('|'));
const args=f=>[f.actor,f.program,f.participant,f.access];
async function fixture(){
 const f={program:randomUUID(),participant:randomUUID(),actor:randomUUID(),access:randomUUID()};
 await db.query("insert into engagements values($1,'Synthetic program','SYNTHETIC','active',null)",[f.program]);
 await db.query("insert into participants values($1,'Synthetic participant')",[f.participant]);
 await db.query('insert into engagement_participants values($1,$2)',[f.program,f.participant]);
 await db.query('insert into app_client_access_codes values($1,$2,$3,$4,true,null)',[f.access,f.program,f.participant,f.actor]);
 await db.query("insert into program_modules values($1,'peta',true)",[f.program]);
 f.workspace=await call('peta_program_setup',[adminA,f.program,'Approved synthetic policy',true]);
 return f;
}
async function start(f,review=true){
 const token=hash(randomUUID()),csrf=hash(randomUUID());
 const session=await call('peta_program_open',[...args(f),token,csrf,hash(randomUUID()),'peta-program-privacy-v1',review]);
 return {token,csrf,session};
}
async function finish(f,review=true){
 const s=await start(f,review);
 for(let i=0;i<24;i++)await call('peta_save_answer',[s.token,s.csrf,i,blocks[i].id,'A','B']);
 await call('peta_submit',[s.token,s.csrf,24,hash(randomUUID()),JSON.stringify(mapping)]);
 return s;
}
const dashboard=(f,actor=adminB,scope='active',page=0,search='',status='all')=>call('peta_team_dashboard',[actor,f.workspace,scope,page,search,status]);
let checks=0;
function passed(name){checks++;console.log('PASS '+name);}
try{
 await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create table engagements(id uuid primary key,title text,code text,status text,end_date date);create table participants(id uuid primary key,name text);create table engagement_participants(engagement_id uuid,participant_id uuid);create table app_client_access_codes(id uuid primary key,program_id uuid,participant_id uuid,auth_user_id uuid,is_active boolean,expires_at timestamptz);create table program_modules(program_id uuid,module_key text check(module_key in ('tbos','lep','binainsight','pre_test','post_test')),enabled boolean);");
 for(const file of ['0076_peta_invitation_pilot.sql','0077_peta_program_module.sql','0078_peta_history_program_status.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 await call('peta_install_source',[JSON.stringify(pub),JSON.stringify({algorithm:'A256GCM'}),fingerprint,pub.contentSha256]);
 const f=await fixture(),first=await start(f,false);
 const before=(await db.query('select * from peta_sessions where id=$1',[first.session.id])).rows[0];
 for(let i=0;i<2;i++)await db.exec(readFileSync('supabase/migrations/0079_peta_admin_team_access.sql','utf8'));
 assert.deepEqual((await db.query('select * from peta_sessions where id=$1',[first.session.id])).rows[0],before);
 passed('SQL79 reruns without changing existing participant rows');

 for(let i=0;i<3;i++){
  const next={...f,participant:randomUUID(),actor:randomUUID(),access:randomUUID()};
  await db.query("insert into participants values($1,'Additional synthetic participant')",[next.participant]);
  await db.query('insert into engagement_participants values($1,$2)',[f.program,next.participant]);
  await db.query('insert into app_client_access_codes values($1,$2,$3,$4,true,null)',[next.access,f.program,next.participant,next.actor]);await start(next);
 }
 const a=await dashboard(f,adminA),b=await dashboard(f);
 assert.deepEqual(a,b);assert.deepEqual(b.counts,{total:4,inProgress:4,submitted:0});assert.equal(b.sessions.length,4);
 passed('both admins see the same four participants and progress');

 assert.equal(await call('peta_team_program_setup',[adminB,f.program,'Updated synthetic policy',true]),f.workspace);
 assert.deepEqual((await db.query('select owner_id,consultant_id from peta_workspaces where id=$1',[f.workspace])).rows[0],{owner_id:adminA,consultant_id:adminA});
 assert.deepEqual((await db.query('select * from peta_sessions where id=$1',[first.session.id])).rows[0],before);
 passed('shared settings preserve creator, permission and retention snapshots');

 const allowed=await fixture(),s=await finish(allowed),resultA=await call('peta_team_session_action',[adminA,s.session.id,'result']);
 assert.deepEqual(await call('peta_team_session_action',[adminB,s.session.id,'result']),resultA);
 assert.equal((await dashboard(allowed)).sessions[0].canReadResult,true);
 assert.deepEqual(resultA.result.rows,[...'DISC'].map(dimension=>({dimension,most:6,least:6,net:0})));
 const readers=(await db.query("select distinct actor_id from peta_access_audit where session_id=$1 and event='consultant_result_opened'",[s.session.id])).rows.map(row=>row.actor_id);
 assert(readers.includes(adminA)&&readers.includes(adminB));
 passed('both admins read the same final score and audit identifies each real reader');

 await db.query("update engagements set status='completed' where id=$1",[allowed.program]);
 assert.equal((await dashboard(allowed)).total,0);assert.equal((await dashboard(allowed,adminB,'history')).sessions[0].canReadResult,true);
 assert.deepEqual(await call('peta_team_session_action',[adminB,s.session.id,'result']),resultA);
 passed('completed programs retain shared history without reopening participant entry');

 const declined=await fixture(),d=await finish(declined,false);
 for(const actor of [adminA,adminB]){
  assert.equal((await dashboard(declined,actor)).sessions[0].canReadResult,false);
  await assert.rejects(call('peta_team_session_action',[actor,d.session.id,'result']),/PETA_NOT_FOUND/);
 }
 passed('declined participant review consent denies reports to every admin');
 await db.query("update peta_sessions set retention_until=now()-interval '1 minute' where id=$1",[s.session.id]);
 await assert.rejects(call('peta_team_session_action',[adminB,s.session.id,'result']),/PETA_NOT_FOUND/);
 const revoked=await fixture(),r=await finish(revoked);
 await call('peta_team_session_action',[adminB,r.session.id,'revoke']);
 await assert.rejects(call('peta_team_session_action',[adminA,r.session.id,'result']),/PETA_NOT_FOUND/);
 passed('expired and revoked reports stay inaccessible to every admin');

 for(const name of ['peta_team_dashboard(uuid,uuid,text,integer,text,text)','peta_team_program_setup(uuid,uuid,text,boolean)','peta_team_session_action(uuid,uuid,text,text,boolean)','peta_team_invitation_create(uuid,uuid,text,text)','peta_team_invitation_revoke(uuid,uuid)']){
  for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2,'execute') as allowed",[role,'public.'+name])).rows[0].allowed,false);
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'execute') as allowed",['public.'+name])).rows[0].allowed,true);
 }
 assert.equal((await db.query("select has_table_privilege('authenticated','public.peta_results','select') as allowed")).rows[0].allowed,false);
 await assert.rejects(call('peta_team_dashboard',[null]),/PETA_INVALID_REQUEST/);
 await assert.rejects(call('peta_team_session_action',[null,randomUUID(),'result']),/PETA_NOT_FOUND/);
 passed('team RPCs are service-only and raw results remain unavailable to browser roles');

 const legacy=await call('peta_workspace_create',[adminA,'Legacy synthetic','Approved synthetic policy',true]);
 const invitation=await call('peta_team_invitation_create',[adminB,legacy,hash(randomUUID()),'TEAM-LEGACY']);
 assert.equal(await call('peta_team_invitation_revoke',[adminB,invitation.id]),true);
 assert.equal((await db.query("select actor_id from peta_access_audit where workspace_id=$1 and event='invitation_revoked'",[legacy])).rows[0].actor_id,adminB);
 await assert.rejects(call('peta_team_session_action',[adminB,first.session.id,'recover',hash(randomUUID()),true]),/PETA_INVALID_REQUEST/);
 await assert.rejects(call('peta_team_session_action',[adminB,first.session.id,'erase',null,false]),/PETA_INVALID_REQUEST/);
 passed('legacy management audits the actual admin; program recovery and unconfirmed erasure are denied');

 const source=readFileSync('src/lib/peta/contracts.ts','utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const parsedModule=new Module(resolve('src/lib/peta/contracts.sandbox.cjs'));
 parsedModule.filename=resolve('src/lib/peta/contracts.sandbox.cjs');
 parsedModule.paths=[resolve('node_modules')];parsedModule._compile(compiled,parsedModule.filename);
 const corrected=parsedModule.exports.PetaSession.parse(first.session);
 assert.equal(corrected.blocks[13].options[0].text,'Koordinasi antar tim.');
 assert.equal(corrected.blocks[12].options[0].text,'Koordinasi antartim.');
 assert.deepEqual(corrected.blocks[13].options.map(({id,code})=>({id,code})),first.session.blocks[13].options.map(({id,code})=>({id,code})));
 assert.equal(first.session.blocks[13].options[0].text,'Koordinasi antartim.');
 passed('situation14 typo is corrected only in public display; source, IDs and score are unchanged');

 // Exercise the real HTTP guard/route with synthetic identity/provider adapters.
 // No auth provider, encrypted CEO source or remote network is consulted.
 const require=createRequire(import.meta.url),{NextRequest}=require('next/server');
 function compile(path,dependencies){
  const filename=resolve(path),mod=new Module(filename);
  mod.filename=filename;mod.paths=[resolve('node_modules')];
  const nativeRequire=mod.require.bind(mod);
  mod.require=name=>Object.hasOwn(dependencies,name)?dependencies[name]:nativeRequire(name);
  mod._compile(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
  return mod.exports;
 }
 let httpActor=adminB,rpcReads=0;
 const contracts=parsedModule.exports;
 const http=compile('src/lib/peta/http.ts',{
  'server-only':{},'./contracts':contracts,
  '@/lib/admin-auth':{requireAdmin:async()=>[adminA,adminB].includes(httpActor)?{userId:httpActor}:{error:'Denied',status:403}},
  '@/lib/rate-limit':{enforceRateLimit:async()=>null},
  '@/lib/supabase':{createServerSupabase:()=>({rpc:async(name,parameters)=>{
   rpcReads++;
   try{return {data:await call(name,Object.values(parameters)),error:null};}
   catch(error){return {data:null,error:{message:error.message}};}
  }})},
  '../../../scripts/lib/peta-source.mjs':{openKey:()=>({optionToDimension:mapping})},
 });
 const route=compile('src/app/api/peta/[[...path]]/route.ts',{
  '@/lib/peta/contracts':contracts,'@/lib/peta/http':{...http,source:async()=>({mapping})},
  '@/lib/peta/program':{programActor:()=>{throw Error('Not a participant request');},scopedCredential:()=>{throw Error('Not a participant request');}},
 });
 const request=(path,method='GET',value)=>new NextRequest('https://api.binahub.id/api/peta/'+path,{method,headers:{Origin:'https://app.binahub.id','Content-Type':'application/json'},...(value===undefined?{}:{body:JSON.stringify(value)})});
 const context=path=>({params:Promise.resolve({path:path.split('?')[0].split('/')})});
 for(const actor of [null,randomUUID()]){
  httpActor=actor;const beforeReads=rpcReads;
  for(const path of ['admin','admin/workspaces','admin/invitations','admin/invitation-revoke','admin/session-action']){
   const method=path==='admin'?'GET':'POST';
   assert.equal((await route[method](request(path,method,method==='POST'?{}:undefined),context(path))).status,403);
  }
  assert.equal(rpcReads,beforeReads);
 }
 passed('all five admin HTTP endpoints reject non-admins before shared database access');
 httpActor=adminB;
 const adminQuery='admin?workspace='+f.workspace;
 const httpDashboard=await route.GET(request(adminQuery),context('admin'));
 assert.equal(httpDashboard.status,200);assert.equal((await httpDashboard.json()).counts.total,4);
 const httpFixture=await fixture(),httpSession=await finish(httpFixture);
 const action={id:httpSession.session.id,action:'result',verified:false};
 const beforeSpoof=rpcReads;
 assert.equal((await route.POST(request('admin/session-action','POST',{...action,ownerId:adminA}),context('admin/session-action'))).status,400);
 assert.equal(rpcReads,beforeSpoof);
 const httpResult=await route.POST(request('admin/session-action','POST',action),context('admin/session-action'));
 assert.equal(httpResult.status,200);assert.equal(JSON.stringify(await httpResult.json()).includes('qualityFlags'),false);
 passed('admin B can read admin A progress/results through HTTP; spoofed ownership and private flags are rejected');
 console.log(checks+' PETA team integration checks passed. No production access.');
}finally{await db.close();}
