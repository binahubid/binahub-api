import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({rpc:vi.fn(),ai:vi.fn(),send:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('./http',()=>({spinRPC:mocks.rpc}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:vi.fn()}));
vi.mock('@/lib/ai-provider',()=>({callRoutedAI:mocks.ai}));
vi.mock('resend',()=>({Resend:class{emails={send:mocks.send};}}));
import { processSpinWork } from './worker';
import { SPIN_DEFINITION,spinHash,summaryHash,validateSpinAnswers,validateSpinWrite } from './intake';
import { spinOptions,spinVisible,spinSanitize,type SpinAnswers } from './form';
import { SpinReportSchema } from './report';

const db=new PGlite();
const rpc=async(name:string,args:Record<string,unknown>)=>{
 const entries=Object.entries(args);
 const sql=`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) as value`;
 return (await db.query<{value:unknown}>(sql,entries.map(([,value])=>value&&typeof value==='object'?JSON.stringify(value):value))).rows[0].value;
};
function answers(){
 const a:SpinAnswers={};
 for(const f of SPIN_DEFINITION.fields){if(!f.required||!spinVisible(f,a))continue;
  if(f.type==='text')a[f.key]='Kebutuhan kerja yang lebih efektif.';
  else if(f.type==='number')a[f.key]=20;
  else{const opts=spinOptions(f,a);a[f.key]=f.type==='multi'?[opts[0].value]:opts[0].value;}}
 return validateSpinAnswers(spinSanitize(SPIN_DEFINITION,{...a,countStatus:'known',participantCount:20,
  programScope:'one_team',problemCluster:'C8',symptoms:['S3'],effects:['E1'],barriers:['none'],
  priorEfforts:['P8'],approaches:['A1'],duration:'one',deliveryMode:'onsite',location:'Jakarta',facilities:'ready',
  desiredOutcome:'Rapat menghasilkan keputusan dan tindak lanjut yang jelas.'}),true);
}
async function submit(mode:'confirmed'|'edited'|'supplemented'='confirmed'){
 const id=randomUUID(),hash=spinHash(id),a=answers();
 await rpc('spin_start',{p_id:id,p_hash:hash,p_version:SPIN_DEFINITION.version,p_notice:'spin-processing-indefinite-v1'});
 const confirmation={hash:summaryHash(a),status:mode,corrections:mode==='confirmed'?{}:{outcome:'Keputusan rapat memiliki penanggung jawab dan tenggat pelaksanaan.'}};
 const reviewed=validateSpinWrite({key:hash,revision:0,answers:a,confirmation});
 await rpc('spin_write',{p_id:id,p_hash:hash,p_revision:0,p_answers:a,
  p_confirmation:confirmation,p_summary:reviewed.summary,
  p_submit:{idempotencyKey:hash,processingConsent:true,marketingConsent:false,noticeVersion:'spin-processing-indefinite-v1',
   contact:{name:'Synthetic participant',email:id+'@example.invalid',company:'Synthetic organization'}}});
 return id;
}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table leads(id uuid primary key default gen_random_uuid(),name text,email text unique,company text,phone text,source text,lifecycle_stage text,opportunity_stage text,source_metadata jsonb);
 create table inquiries(id uuid primary key default gen_random_uuid(),lead_id uuid,name text,email text,whatsapp text,message text,source text,status text,module_request_data jsonb,follow_up_paused boolean,reply_status text,reply_email_id text,reply_sent_at timestamptz);
 create table assessments(lead_id uuid,follow_up_paused boolean,result_email_sent_at timestamptz,assessment_status text);`);
 await db.exec(readFileSync('supabase/migrations/0071_spin_discovery.sql','utf8'));
},30000);
afterAll(()=>db.close());
beforeEach(()=>{
 vi.clearAllMocks();mocks.rpc.mockImplementation(rpc);
 vi.stubEnv('PROPOSAL_LINK_SECRET','s'.repeat(40));vi.stubEnv('RESEND_API_KEY','synthetic');
 vi.stubEnv('EMAIL_FROM','BinaHub <sender@example.invalid>');vi.stubEnv('APP_PUBLIC_URL','https://app.example.invalid');
 mocks.send.mockResolvedValue({data:{id:'synthetic-delivery'},error:null});
 mocks.ai.mockImplementation(async(input)=>{
  const content=JSON.stringify({matches:[{solutionCode:'SS-29',evidenceLinks:[
   {evidenceId:'Q05',objectiveId:'SS-29.LO01'},{evidenceId:'Q13',objectiveId:'SS-29.LO01'}]}]});
  input.validateContent(content);return {content,provider:'openrouter',model:'synthetic'};
 });
});
afterAll(()=>vi.unstubAllEnvs());

describe('SPIN persisted submit → AI → report → PDF → email (synthetic PGlite, mocked providers)',()=>{
 it('accepts real PostgreSQL timestamp format, produces an AI recommendation, and dispatches exactly once',async()=>{
  const id=await submit();
  const claimed=await rpc('spin_claim',{p_id:id}) as {submitted_at:string;lease:string};
  expect(claimed.submitted_at).toMatch(/[+-]\d{2}:\d{2}$/);
  await db.query("update spin_submissions set status='queued',lease=null,lease_until=null,attempts=0 where id=$1",[id]);
  expect(await processSpinWork(id)).toEqual({processed:true,status:'sent'});
  expect(mocks.ai).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledOnce();
  const row=(await db.query<{status:string;report:unknown}>('select status,report from spin_submissions where id=$1',[id])).rows[0];
  const report=SpinReportSchema.parse(row.report);
  expect(row.status).toBe('ready');expect(report.issuedAt).toMatch(/Z$/);
  expect(report.solutions[0].code).toBe('SS-29');
  expect(mocks.send.mock.calls[0][0].attachments[0].content.subarray(0,4).toString()).toBe('%PDF');
  expect(JSON.stringify(mocks.ai.mock.calls[0][0])).not.toMatch(/example.invalid|Synthetic participant|Synthetic organization/);
  expect((await processSpinWork(id)).processed).toBe(false);
  expect(mocks.ai).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledOnce();
 },20000);
 it('still sends a truthful consultation report when AI is unavailable, without inventing programs',async()=>{
  const id=await submit();mocks.ai.mockRejectedValue(new Error('Synthetic provider failure'));
  expect(await processSpinWork(id)).toEqual({processed:true,status:'sent'});
  const report=(await db.query<{report:{solutions:unknown[]}}>('select report from spin_submissions where id=$1',[id])).rows[0].report;
  expect(report.solutions).toEqual([]);expect(mocks.send).toHaveBeenCalledOnce();
 },20000);
 it.each(['edited','supplemented'] as const)('analyses a client-confirmed %s summary using the corrections and retains conservative public review rules',async(mode)=>{
  const id=await submit(mode);
  expect((await processSpinWork(id)).status).toBe('sent');expect(mocks.ai).toHaveBeenCalledOnce();
  const prompt=JSON.parse(mocks.ai.mock.calls[0][0].messages[1].content);
  expect(prompt.needs.evidence.find((e:{id:string})=>e.id==='Q13').text).toContain('Keputusan rapat memiliki penanggung jawab');
  const row=(await db.query<{report:{solutions:unknown[];exploration:unknown[];advisory:{status:string}};internal_report:{aiCandidates:unknown[]}}>('select report,internal_report from spin_submissions where id=$1',[id])).rows[0];
  expect(row.report.solutions).toEqual([]);expect(row.internal_report.aiCandidates).toHaveLength(1);
  expect(row.report.exploration).toHaveLength(1);expect(row.report.advisory.status).toBe('review_required');
  expect(mocks.send).toHaveBeenCalledOnce();
 },20000);
 it('rejects a stale or unverified summary before AI and never enqueues email',async()=>{
  const id=await submit();await db.query("update spin_submissions set summary=summary||'{\"outcome\":\"Stale snapshot\"}'::jsonb where id=$1",[id]);
  expect((await processSpinWork(id)).processed).toBe(false);expect(mocks.ai).not.toHaveBeenCalled();expect(mocks.send).not.toHaveBeenCalled();
  expect((await db.query<{status:string}>('select status from spin_submissions where id=$1',[id])).rows[0].status).toBe('failed');
 },20000);
 it('keeps delivery pending on provider rejection and respects the stored backoff',async()=>{
  const id=await submit();mocks.send.mockResolvedValue({data:null,error:{message:'Synthetic rejection'}});
  expect(await processSpinWork(id)).toEqual({processed:true,status:'pending'});
  expect((await processSpinWork(id)).processed).toBe(false);
  expect(mocks.ai).toHaveBeenCalledOnce();expect(mocks.send).toHaveBeenCalledOnce();
  expect((await db.query<{status:string}>('select status from spin_mail_jobs where submission_id=$1',[id])).rows[0].status).toBe('pending');
 },20000);
 it.each(['2026-10-27T04:03:26.014820+00:00','2026-10-27T11:03:26.014820+07:00','2026-10-27T04:03:26.014Z'])('normalizes %s to a canonical UTC report date',async(timestamp)=>{
  const id=await submit();await db.query('update spin_submissions set submitted_at=$2 where id=$1',[id,timestamp]);
  expect((await processSpinWork(id)).status).toBe('sent');
  expect((await db.query<{report:{issuedAt:string}}>('select report from spin_submissions where id=$1',[id])).rows[0].report.issuedAt).toBe('2026-10-27T04:03:26.014Z');
 },20000);
});
