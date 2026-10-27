import { beforeEach,describe,it,expect,vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),auth:vi.fn(),limit:vi.fn(),after:vi.fn(),worker:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:mocks.rpc})}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:mocks.limit}));
vi.mock('@/lib/spin/worker',()=>({processSpinWork:mocks.worker,processSpinMail:mocks.worker,spinAvailability:async()=>true,spinRandomKey:()=> 'b'.repeat(64)}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:mocks.after}));
import {POST as start} from '@/app/api/discovery/spin/route';
import {PATCH as write} from '@/app/api/discovery/spin/[id]/route';
import {POST as result} from '@/app/api/discovery/spin/[id]/result/route';
import {GET as admin} from '@/app/api/admin/discovery/route';
import {POST as retry} from '@/app/api/admin/discovery/[id]/retry/route';
import {POST as requestLink} from '@/app/api/discovery/spin/[id]/request-link/route';
import {SPIN_DEFINITION,summaryHash,spinChallenge,spinHash} from './intake';
import {spinOptions,spinVisible,spinSanitize,SPIN_NOTICE_VERSION,type SpinAnswers} from './form';
const id='11111111-1111-4111-8111-111111111111',key='a'.repeat(64),ctx={params:Promise.resolve({id})};
const req=(body:unknown,path='/api/discovery/spin',method='POST',origin='https://app.binahub.id')=>new NextRequest('https://api.binahub.id'+path,{method,headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('PROPOSAL_LINK_SECRET','s'.repeat(40));mocks.limit.mockResolvedValue(null);mocks.rpc.mockResolvedValue({data:{id,status:'draft',answers:{},confirmation:null,revision:0},error:null});mocks.auth.mockResolvedValue({error:'Denied',status:403});});
describe('SPIN route boundaries (no real database/model/email)',()=>{
 it('requires processing consent and hashes draft capabilities before storage',async()=>{
 expect((await start(req({id,key,processingConsent:true,noticeVersion:SPIN_NOTICE_VERSION,website:''}))).status).toBe(201);
 expect(mocks.rpc.mock.calls[0]).toEqual(['spin_start',expect.objectContaining({p_hash:spinHash(key)})]);
 expect((await start(req({id,key,processingConsent:false,noticeVersion:SPIN_NOTICE_VERSION,website:''}))).status).toBe(400);
 });
 it('rejects cross-origin writes before touching privileged storage',async()=>{
 expect((await start(req({id,key},undefined,undefined,'https://untrusted.invalid'))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('guards admin read and processing endpoints before any storage or work',async()=>{
 expect((await admin(new NextRequest('https://api.binahub.id/api/admin/discovery'))).status).toBe(403);
 expect((await retry(req({action:'process_pending'}),ctx)).status).toBe(403);
 expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.after).not.toHaveBeenCalled();
 });
 it('never returns reports, raw DB diagnostics or internal objects to a draft writer',async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{id,status:'draft',answers:{},confirmation:null,revision:0,report:{private:'report'},internal_report:{private:'internal'},contact:{email:'private@example.invalid'},draft_hash:'private'},error:null});
 const allowed=await start(req({id,key,processingConsent:true,noticeVersion:SPIN_NOTICE_VERSION,website:''}));
 expect(allowed.status).toBe(201);expect(JSON.stringify(await allowed.json())).not.toMatch(/private|internal_report|draft_hash|contact/);
 mocks.rpc.mockResolvedValue({error:{message:'SPIN_REVISION_CONFLICT private@example.invalid',code:'P0001'}});
 const r=await write(req({key,revision:0,answers:{},confirmation:null},'/api/discovery/spin/'+id,'PATCH'),ctx);
 expect(r.status).toBe(409);expect(JSON.stringify(await r.json())).not.toMatch(/private@example/);
 });
 it('requeues processing only after admin authentication and surfaces missing recovery SQL honestly',async()=>{
 const actor='22222222-2222-4222-8222-222222222222';mocks.auth.mockResolvedValue({userId:actor,email:'admin@example.invalid'});
 mocks.rpc.mockResolvedValue({data:true,error:null});
 expect((await retry(req({action:'process_pending'}),ctx)).status).toBe(202);
 expect(mocks.rpc).toHaveBeenCalledWith('spin_retry_processing',{p_id:id,p_actor:actor});
 expect(mocks.after).toHaveBeenCalledOnce();mocks.after.mockClear();
 mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'Missing function'}});
 const unavailable=await retry(req({action:'process_pending'}),ctx);
 expect(unavailable.status).toBe(503);expect((await unavailable.json()).code).toBe('SPIN_RETRY_SETUP_REQUIRED');
 expect(mocks.after).not.toHaveBeenCalled();
 });
 it('accepts a validated submit without waiting for AI/email, schedules recovery after persisted acceptance',async()=>{
 const answers:SpinAnswers={};for(const f of SPIN_DEFINITION.fields){if(!spinVisible(f,answers)||!f.required)continue;
 if(f.type==='text')answers[f.key]='Kebutuhan kerja yang lebih efektif.';else if(f.type==='number')answers[f.key]=20;
 else{const opts=spinOptions(f,answers);answers[f.key]=f.type==='multi'?[opts[0].value]:opts[0].value;}}
 const a=spinSanitize(SPIN_DEFINITION,answers);
 const body={key,revision:0,answers:a,confirmation:{status:'confirmed',hash:summaryHash(a),corrections:{}},
 submit:{idempotencyKey:key,processingConsent:true,noticeVersion:SPIN_NOTICE_VERSION,marketingConsent:false,conflictsAcknowledged:true,website:'',
 challengeAnswer:spinChallenge(id).answer,contact:{name:'Synthetic',email:'synthetic@example.invalid',company:'Synthetic'}}};
 const r=await write(req(body,'/api/discovery/spin/'+id,'PATCH'),ctx);expect(r.status).toBe(202);
 expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.worker).not.toHaveBeenCalled();
 expect((await write(req({...body,submit:{...body.submit,challengeAnswer:99}},undefined,'PATCH'),ctx)).status).toBe(422);
 });
 it('opens a report only through a scoped POST link exchange; returns public report schema only',async()=>{
 const r=await result(req({action:'read',session:key}),ctx);
 expect(r.status).toBe(503); // mock returns an invalid report rather than a report-shaped internal row
 expect(JSON.stringify(await r.json())).not.toMatch(/draft_hash|lease|internal_report|contact/);
 });
 it('does not reveal whether a recovery email matches and never runs email work in the request',async()=>{
 const r=await requestLink(req({email:'synthetic@example.invalid',website:''}),ctx);
 expect(r.status).toBe(202);expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.worker).not.toHaveBeenCalled();
 });
});
