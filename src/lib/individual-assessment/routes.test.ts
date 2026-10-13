import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach,describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const deps=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),db:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/auth-role',()=>({getUserFromBearer:deps.auth}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:deps.db}));
import { GET,POST } from '@/app/api/assessment/individual/route';
import { PATCH,GET as read,DELETE } from '@/app/api/assessment/individual/[id]/route';
import { PE_CONSENT_VERSION,PE_PRIVACY_VERSION } from './delivery-contracts';
import { hashPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';

const owner=randomUUID(),id=randomUUID(),bundle=makeSyntheticPEInstrument();
const now=new Date().toISOString(),context={role:'Manager',goal:'Growth',relevance:{'PE-02':'high','PE-04':'normal','PE-06':'normal'}};
const attempt={id,policyId:'pe-free3-2026-10-13-v1',status:'draft',revision:0,responses:{},context,
  result:null,createdAt:now,updatedAt:now,submittedAt:null,retentionUntil:now};
const request=(method='GET',body?:unknown)=>new NextRequest(`https://api.binahub.test/api/assessment/individual/${id}`,{
  method,headers:{Authorization:'Bearer verified-test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{
  vi.clearAllMocks();deps.auth.mockResolvedValue({user:{id:owner,email_confirmed_at:now}});deps.limit.mockResolvedValue(null);
  deps.db.mockReturnValue({from:deps.from,rpc:deps.rpc});deps.rpc.mockImplementation(async(name:string)=>({
    data:name==='pe_owner_review_access'?{shared:false,evaluationConsent:false,clarity:null,usefulness:null}:name==='pe_pilot_ready'?true:attempt,error:null}));
  deps.from.mockImplementation((table:string)=>{
    const data=table==='pe_instrument_versions'?{manifest:bundle,bundle_sha256:hashPEInstrument(bundle)}:
      {id:'pe-free3-2026-10-13-v1',instrument_version:'1.0.0-draft.1',release_status:'development_pilot',content_review:'ceo_reviewed',
        free_codes:['PE-02','PE-04','PE-06'],consent_version:PE_CONSENT_VERSION,privacy_version:PE_PRIVACY_VERSION};
    return {select(){return this;},eq(){return this;},maybeSingle:async()=>({data,error:null})};
  });
});
describe('PE HTTP access/input/private-data boundary',()=>{
  it('rejects anonymous/unconfirmed access before touching data, and supports rate limits',async()=>{
    deps.auth.mockResolvedValueOnce({error:'not authenticated',status:401});expect((await GET(request())).status).toBe(401);
    expect(deps.db).not.toHaveBeenCalled();
    deps.auth.mockResolvedValueOnce({user:{id:owner}});expect((await GET(request())).status).toBe(403);
    deps.limit.mockResolvedValueOnce(new Response('{}',{status:429}));expect((await GET(request())).status).toBe(429);
  });
  it('returns 18 entitled questions without private keys or locked areas',async()=>{
    const result=await GET(request());expect(result.status).toBe(200);
    const payload=await result.json();expect(payload.definition.sjtItems).toHaveLength(6);
    expect(payload.definition.selfReportItems).toHaveLength(12);
    expect(JSON.stringify(payload)).not.toMatch(/option_scores|scoring_key|rationales|PE-01|PE-03|PE-05/);
    expect(result.headers.get('Cache-Control')).toContain('no-store');
  });
  it('starts with server-bound identity and refuses forged roles/owner/consent',async()=>{
    const body={id,context,consentVersion:PE_CONSENT_VERSION,privacyVersion:PE_PRIVACY_VERSION};
    expect((await POST(request('POST',body))).status).toBe(201);
    expect(deps.rpc.mock.calls[0][1]).toMatchObject({p_owner:owner});
    const calls=deps.rpc.mock.calls.length;
    expect((await POST(request('POST',{...body,owner_id:randomUUID()}))).status).toBe(400);
    expect(deps.rpc.mock.calls).toHaveLength(calls);
    expect((await POST(request('POST',{...body,consentVersion:'wrong'}))).status).toBe(400);
  });
  it('enforces owner on read/write/delete and exposes meaningful safe conflicts',async()=>{
    const ctx={params:Promise.resolve({id})};
    expect((await read(request(),ctx)).status).toBe(200);
    expect((await PATCH(request('PATCH',{revision:0,responses:{SR05:3}}),ctx)).status).toBe(200);
    expect(deps.rpc.mock.calls.find(([name])=>name==='pe_write_participant')?.[1]).toMatchObject({p_owner:owner,p_id:id,p_revision:0,p_responses:{SR05:3}});
    deps.rpc.mockResolvedValueOnce({data:null,error:{message:'PE_REVISION_CONFLICT PRIVATE DETAIL'}});
    const response=await PATCH(request('PATCH',{revision:0,responses:{}}),ctx);
    expect(response.status).toBe(409);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE DETAIL');
    deps.rpc.mockResolvedValueOnce({data:true,error:null});expect((await DELETE(request('DELETE'),ctx)).status).toBe(200);
  });
  it('rejects oversized/malformed request bodies and guessed result IDs safely',async()=>{
    const oversized=request('POST',{text:'x'.repeat(17*1024)});expect((await POST(oversized)).status).toBe(413);
    deps.rpc.mockResolvedValueOnce({data:null,error:{message:'PE_ATTEMPT_NOT_FOUND'}});
    expect((await read(request(),{params:Promise.resolve({id})})).status).toBe(404);
    expect((await read(request(),{params:Promise.resolve({id:'bad'})})).status).toBe(400);
  });
});
