import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {syntheticPeta,syntheticHash as hash} from './synthetic';
import {sealKey,openKey,keyHash,validateSource} from '../../../scripts/lib/peta-source.mjs';
const db=new PGlite(),{pub,priv}=syntheticPeta(),secret='a'.repeat(64),sealed=sealKey(pub,priv,secret);
const call=async(name:string,args:unknown[]=[])=> (await db.query<{value:unknown}>('select public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as value',args)).rows[0].value;
const json=(v:unknown)=>JSON.stringify(v);
async function start(review=true,consultant=true){const actor=randomUUID(),w=await call('peta_workspace_create',[actor,'Synthetic workspace','Approved synthetic policy',consultant]);const invite=hash(randomUUID()),token=hash(randomUUID()),csrf=hash(randomUUID());await call('peta_invitation_create',[actor,w,invite,'SYNTHETIC']);const s=await call('peta_redeem',[invite,token,csrf,'peta-privacy-v1',review]) as {id:string;revision:number;retentionUntil:string};return {actor,w,invite,token,csrf,s};}
async function answerAll(t:Awaited<ReturnType<typeof start>>){for(let i=0;i<24;i++)await call('peta_save_answer',[t.token,t.csrf,i,pub.blocks[i].id,'A','B']);}
beforeAll(async()=>{await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');await db.exec(readFileSync('supabase/migrations/0076_peta_invitation_pilot.sql','utf8'));await call('peta_install_source',[json(pub),json(sealed.sealed),sealed.keyFingerprint,pub.contentSha256]);},30000);
afterAll(()=>db.close());
describe('PETA encrypted source and isolated lifecycle',()=>{
 it('preserves the source, detects text/key/envelope tampering, never silently rotates',async()=>{
  expect(validateSource(pub,priv)).toBe(true);expect(openKey(pub,sealed.sealed,sealed.keyFingerprint,secret)).toEqual(priv);
  expect(()=>openKey(pub,sealed.sealed,sealed.keyFingerprint,'b'.repeat(64))).toThrow('PETA_SOURCE_INVALID');
  expect(()=>openKey({...pub,contentSha256:'0'.repeat(64)},sealed.sealed,sealed.keyFingerprint,secret)).toThrow();
  expect(()=>openKey(pub,{...sealed.sealed,tag:Buffer.alloc(16).toString('base64')},sealed.keyFingerprint,secret)).toThrow();
  await expect(call('peta_install_source',[json(pub),json({...sealed.sealed,tag:'tampered'}),sealed.keyFingerprint,pub.contentSha256])).rejects.toThrow('PETA_SOURCE_IMMUTABLE');
 });
 it('rejects consent mismatch, links once, unknown and expired invitations',async()=>{
  const actor=randomUUID(),w=await call('peta_workspace_create',[actor,'Synthetic','Approved synthetic policy',false]),invite=hash(randomUUID());await call('peta_invitation_create',[actor,w,invite,'SYNTHETIC']);
  await expect(call('peta_redeem',[invite,hash('cred'),hash('csrf'),'wrong',false])).rejects.toThrow('PETA_CONSENT_REQUIRED');
  const t=await start();await expect(call('peta_redeem',[t.invite,hash('cred2'),hash('csrf2'),'peta-privacy-v1',true])).rejects.toThrow('PETA_LINK_EXPIRED');
  await expect(call('peta_invitation_info',[hash('unknown')])).rejects.toThrow('PETA_LINK_EXPIRED');
  await db.query("update peta_invitations set expires_at=now()-interval '1 minute' where token_hash=$1",[invite]);await expect(call('peta_invitation_info',[invite])).rejects.toThrow('PETA_LINK_EXPIRED');
 });
 it('sets a calendar year retention and no report before submission',async()=>{const t=await start();const diff=Date.parse(t.s.retentionUntil)-Date.now();expect(diff).toBeGreaterThan(364*86400000);expect(diff).toBeLessThan(367*86400000);await expect(call('peta_read_result',[t.token])).rejects.toThrow('PETA_RESULT_NOT_READY');});
 it('saves partial pairs; rejects equal/invalid choices, missing csrf and stale revisions',async()=>{
  const t=await start();await call('peta_save_answer',[t.token,t.csrf,0,'PETA-Q01','A',null]);
  await expect(call('peta_save_answer',[t.token,t.csrf,0,'PETA-Q01','A','B'])).rejects.toThrow('PETA_REVISION_CONFLICT');
  for(const [m,l]of [['A','A'],['X','B']])await expect(call('peta_save_answer',[t.token,t.csrf,1,'PETA-Q01',m,l])).rejects.toThrow('PETA_INVALID_ANSWER');
  await expect(call('peta_save_answer',[t.token,hash('wrong'),1,'PETA-Q01','A','B'])).rejects.toThrow('PETA_SESSION_REQUIRED');
  await expect(call('peta_submit',[t.token,t.csrf,1,hash('submit'),json(priv.optionToDimension)])).rejects.toThrow('PETA_INCOMPLETE');
 });
 it('scores all pairs atomically, retains ties and hides reviewer flags from participant DTO',async()=>{
  const t=await start();await answerAll(t);await call('peta_submit',[t.token,t.csrf,24,hash('submit'),json(priv.optionToDimension)]);
  const r=await call('peta_read_result',[t.token]) as {result:{rows:{most:number;least:number;net:number}[];topDimensions:string[]}};
  expect(r.result.rows.reduce((sum,row)=>sum+row.most,0)).toBe(24);expect(r.result.rows.reduce((sum,row)=>sum+row.least,0)).toBe(24);expect(r.result.rows.reduce((sum,row)=>sum+row.net,0)).toBe(0);expect(r.result.topDimensions).toHaveLength(4);
  expect(json(r)).not.toMatch(/qualityFlags|quality_flags|optionToDimension|sealed_key/);
  expect(await call('peta_submit',[t.token,t.csrf,24,hash('submit'),json(priv.optionToDimension)])).toMatchObject({status:'submitted'});
  await expect(call('peta_submit',[t.token,t.csrf,25,hash('different'),json(priv.optionToDimension)])).rejects.toThrow('PETA_FINALIZED');
  await expect(call('peta_save_answer',[t.token,t.csrf,25,'PETA-Q01','B','C'])).rejects.toThrow('PETA_FINALIZED');
  await expect(db.query("update peta_answers set most='D' where session_id=$1 and block_id='PETA-Q01'",[t.s.id])).rejects.toThrow('PETA_FINALIZED');
 });
 it('requires the original sealed key fingerprint, even if a changed map stays balanced',async()=>{
  const t=await start();await answerAll(t);const changed=structuredClone(priv.optionToDimension),ids=Object.keys(changed);[changed[ids[0]],changed[ids[1]]]=[changed[ids[1]],changed[ids[0]]];expect(keyHash(changed)).not.toBe(sealed.keyFingerprint);
  await expect(call('peta_submit',[t.token,t.csrf,24,hash('submit'),json(changed)])).rejects.toThrow('PETA_SOURCE_INVALID');
  expect((await db.query('select * from peta_results where session_id=$1',[t.s.id])).rows).toHaveLength(0);
 });
 it('enforces workspace ownership and explicit consultant permission',async()=>{
  const t=await start(false);await answerAll(t);await call('peta_submit',[t.token,t.csrf,24,hash('submit'),json(priv.optionToDimension)]);
  for(const actor of [randomUUID(),t.actor])await expect(call('peta_admin_action',[actor,t.s.id,'result',null,false])).rejects.toThrow('PETA_NOT_FOUND');
  await expect(call('peta_invitation_create',[randomUUID(),t.w,hash('cross'),'CROSS'])).rejects.toThrow('PETA_NOT_FOUND');
  const allowed=await start();await answerAll(allowed);await call('peta_submit',[allowed.token,allowed.csrf,24,hash('submit'),json(priv.optionToDimension)]);expect(await call('peta_admin_action',[allowed.actor,allowed.s.id,'result',null,false])).toHaveProperty('result');
 });
 it('recovers only after manual identity verification, invalidates old credentials, never extends retention',async()=>{
  const t0=await start();
  const dashboard=await call('peta_admin_dashboard',[t0.actor]) as {sessions:unknown[];audit:unknown[]};
  expect(dashboard.sessions).toEqual([expect.objectContaining({instrumentVersion:'1.0.0-pilot',consentVersion:'peta-privacy-v1',reviewConsent:true})]);
  expect(dashboard.audit).toContainEqual(expect.objectContaining({event:'consented',participantCode:'SYNTHETIC'}));
  expect(json(dashboard)).not.toMatch(/token_hash|csrf_hash|quality_flags|optionToDimension|sealed_key/);
  const foreign=await call('peta_admin_dashboard',[randomUUID()]) as {sessions:unknown[];audit:unknown[]};expect(foreign.sessions).toEqual([]);expect(foreign.audit).toEqual([]);
  const t=await start(),link=hash(randomUUID());await expect(call('peta_admin_action',[t.actor,t.s.id,'recover',link,false])).rejects.toThrow('PETA_INVALID_REQUEST');
  await call('peta_admin_action',[t.actor,t.s.id,'recover',link,true]);const newToken=hash(randomUUID()),csrf=hash(randomUUID());const recovered=await call('peta_redeem',[link,newToken,csrf,'peta-privacy-v1',true]) as {retentionUntil:string};expect(recovered.retentionUntil).toBe(t.s.retentionUntil);await expect(call('peta_read_session',[t.token])).rejects.toThrow('PETA_SESSION_REQUIRED');expect(await call('peta_read_session',[newToken])).toHaveProperty('id',t.s.id);
 });
 it('expires idle sessions, blocks expired data even without a worker, and purges only PETA records',async()=>{
  const t=await start();await db.query("update peta_credentials set last_seen_at=now()-interval '31 minutes' where token_hash=$1",[t.token]);await expect(call('peta_read_session',[t.token])).rejects.toThrow('PETA_SESSION_REQUIRED');
  const old=await start();await db.query("update peta_sessions set retention_until=now()-interval '1 minute' where id=$1",[old.s.id]);await expect(call('peta_read_session',[old.token])).rejects.toThrow('PETA_SESSION_REQUIRED');await call('peta_purge_expired',[100]);expect((await db.query('select id from peta_sessions where id=$1',[old.s.id])).rows).toHaveLength(0);expect((await db.query('select id from peta_sessions where id=$1',[t.s.id])).rows).toHaveLength(1);
 });
 it('denies direct table/helper access to anon and authenticated roles',async()=>{
  for(const role of ['anon','authenticated']){expect((await db.query<{ok:boolean}>("select has_table_privilege($1,'public.peta_sessions','select') ok",[role])).rows[0].ok).toBe(false);expect((await db.query<{ok:boolean}>("select has_function_privilege($1,'public.peta_session_auth(text,text)','execute') ok",[role])).rows[0].ok).toBe(false);}
 });
});
