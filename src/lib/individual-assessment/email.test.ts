import { randomUUID } from 'node:crypto';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const deps=vi.hoisted(()=>({rpc:vi.fn(),send:vi.fn()}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:deps.rpc})}));
vi.mock('resend',()=>({Resend:class {emails={send:deps.send};}}));
import { processPEReportEmail } from './email';
import { hashPEKey,peEmailLinkToken } from './guest';
const id=randomUUID(),attemptId=randomUUID(),leaseToken=randomUUID();
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PROPOSAL_LINK_SECRET','synthetic-secret-not-production-0123456789');vi.stubEnv('RESEND_API_KEY','synthetic');vi.stubEnv('EMAIL_FROM','BinaHub <synthetic@example.invalid>');
  deps.rpc.mockImplementation(async(name:string)=>({data:name==='pe_claim_report_email'?{id,attemptId,leaseToken,email:'synthetic@example.invalid',name:'<script>Synthetic</script>',from:'BinaHub <synthetic@example.invalid>',origin:'https://app.binahub.id',
    linkHash:hashPEKey(peEmailLinkToken(id)),snapshot:{metadata:{assessmentDate:'2026-10-14T00:00:00Z'}}}:true,error:null}));
  deps.send.mockResolvedValue({data:{id:'provider_synthetic'},error:null});});
describe('durable PE email worker (no real sends)',()=>{
  it('uses identical payload and idempotency key across retries, without scores or internal CC',async()=>{
    await processPEReportEmail(attemptId);await processPEReportEmail(attemptId);
    expect(deps.send.mock.calls[0]).toEqual(deps.send.mock.calls[1]);
    const [payload,opts]=deps.send.mock.calls[0];expect(opts).toEqual({idempotencyKey:`pe-result-${id}`});
    expect(payload.cc).toBeUndefined();expect(payload.html).toContain('&lt;script&gt;');expect(payload.html).not.toContain('<script>');expect(payload.html).not.toMatch(/selfReport|scoring_key|responses/);
    expect(deps.rpc.mock.calls.find(([name])=>name==='pe_finish_report_email')?.[1]).toMatchObject({p_provider:'provider_synthetic',p_lease:leaseToken});
  });
  it('records only a safe retry code and retains the leased job if accepted email cannot be persisted',async()=>{
    deps.send.mockResolvedValueOnce({data:null,error:{message:'PRIVATE EMAIL DETAIL'}});await processPEReportEmail(attemptId);
    expect(deps.rpc.mock.calls.at(-1)?.[1]).toMatchObject({p_provider:null,p_error:'PE_EMAIL_DELIVERY_RETRY'});
    deps.rpc.mockImplementation(async(name:string)=>name==='pe_finish_report_email'?{data:null,error:{message:'PRIVATE DB DETAIL'}}:
      {data:{id,attemptId,leaseToken,email:'synthetic@example.invalid',name:'Synthetic',from:'BinaHub <synthetic@example.invalid>',origin:'https://app.binahub.id',linkHash:hashPEKey(peEmailLinkToken(id)),snapshot:{metadata:{assessmentDate:'2026-10-14T00:00:00Z'}}},error:null});
    expect(await processPEReportEmail(attemptId)).toMatchObject({status:'pending'});
    expect(deps.rpc.mock.calls.filter(([name])=>name==='pe_finish_report_email')).toHaveLength(2);
  });
});
afterEach(()=>vi.unstubAllEnvs());
