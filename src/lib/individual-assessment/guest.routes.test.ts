import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const deps=vi.hoisted(()=>({limit:vi.fn(),rpc:vi.fn(),db:vi.fn(),from:vi.fn(),after:vi.fn(),email:vi.fn()}));
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:deps.after}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:deps.db}));
vi.mock('./email',()=>({processPEReportEmail:deps.email}));
import { GET,POST } from '@/app/api/assessment/individual/guest/route';
import { PATCH } from '@/app/api/assessment/individual/guest/[id]/route';
import { GET as resultGET,POST as resultPOST,PATCH as resultPATCH } from '@/app/api/assessment/individual/guest/[id]/result/route';
import { POST as requestLink } from '@/app/api/assessment/individual/guest/request-link/route';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { hashPEInstrument } from './definition';
import { scorePEResponses } from './scoring';
import { PE_POLICY_ID,PE_FREE_CODES } from './delivery-contracts';
const id=randomUUID(),owner=randomUUID(),key='a'.repeat(64),now=new Date().toISOString(),bundle=makeSyntheticPEInstrument();
const context={role:'Synthetic role',goal:'Synthetic goal',relevance:{'PE-02':'low','PE-04':'low','PE-06':'low'}};
const responses=Object.fromEntries([...bundle.config.self_report_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,4]),
  ...bundle.config.sjt_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,'A'])]);
const attempt={id,policyId:PE_POLICY_ID,status:'draft',revision:0,context,responses:{},result:null as unknown,createdAt:now,updatedAt:now,submittedAt:null as string|null,retentionUntil:now};
const final={...attempt,status:'submitted',responses,revision:1,submittedAt:now,result:{instrumentId:'BINAINSIGHTS-PE-V1',instrumentVersion:'1.0.0-draft.1',
  scoringVersion:'pe-dual-method-v1',policyId:PE_POLICY_ID,reportVersion:'pe-web-development-v1',releaseStatus:'development_pilot',contentReview:'ceo_reviewed',priorityVersion:'pe-relevance-evidence-v1',
  completeness:{expectedCount:18,answeredCount:18,naCount:0},competencies:scorePEResponses(responses,bundle).competencies.filter(c=>PE_FREE_CODES.includes(c.code as never))}};
const envelope={attempt,ownerId:owner,name:'Synthetic name',email:'synthetic@example.invalid',report:null,emailStatus:null};
const params={params:Promise.resolve({id})};
const req=(method='GET',body?:unknown,headers:Record<string,string>={})=>new NextRequest(`https://api.binahub.id/api/assessment/individual/guest/${id}`,{
  method,headers:{'Content-Type':'application/json',Authorization:`PE-Draft ${key}`,Origin:'https://app.binahub.id',...headers},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv('PROPOSAL_LINK_SECRET','synthetic-secret-not-production-0123456789');vi.stubEnv('RESEND_API_KEY','synthetic');vi.stubEnv('EMAIL_FROM','BinaHub <synthetic@example.invalid>');
  deps.limit.mockResolvedValue(null);deps.db.mockReturnValue({rpc:deps.rpc,from:deps.from});
  deps.from.mockImplementation((table:string)=>({select(){return this;},eq(){return this;},limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:
    table==='pe_instrument_versions'?{manifest:bundle,bundle_sha256:hashPEInstrument(bundle)}:{id:PE_POLICY_ID,instrument_version:'1.0.0-draft.1',release_status:'development_pilot',content_review:'ceo_reviewed',
      free_codes:[...PE_FREE_CODES],consent_version:'pe-development-consent-v1',privacy_version:'pe-personal-privacy-v1'},error:null})}));
  deps.rpc.mockImplementation(async(name:string)=>({data:name==='pe_pilot_ready'?true:name==='pe_guest_attempt'||name==='pe_start_guest'?envelope:
    name==='pe_write_participant'||name==='pe_read_participant'?final:name==='pe_owner_review_access'?{shared:true,evaluationConsent:false,clarity:null,usefulness:null}:true,error:null}));
});
describe('guest HTTP private boundaries',()=>{
  it('uses a generic email recovery response with no account/ID disclosure, even when matched',async()=>{
    deps.rpc.mockResolvedValueOnce({data:id,error:null});const matched=await requestLink(req('POST',{email:'synthetic@example.invalid'}));
    deps.rpc.mockResolvedValueOnce({data:null,error:null});const missing=await requestLink(req('POST',{email:'unknown@example.invalid'}));
    expect(matched.status).toBe(202);expect(await matched.json()).toEqual(await missing.json());
    expect(deps.after).toHaveBeenCalledOnce();expect(deps.rpc.mock.calls[0][0]).toBe('pe_request_latest_result_link');
  });
  it('serves only the three free areas without scoring keys or auth requirements',async()=>{
    const res=await GET(req());expect(res.status).toBe(200);const value=await res.json();expect(value.definition.selfReportItems).toHaveLength(12);expect(value.definition.sjtItems).toHaveLength(6);
    expect(JSON.stringify(value)).not.toMatch(/option_scores|scoring_key|rationales|PE-01|PE-03|PE-05/);
  });
  it('binds a hashed draft capability; never exposes contacts or owner IDs and rejects forged ownership',async()=>{
    const input={id,context,draftKey:key,name:'Synthetic name',email:'synthetic@example.invalid',consentVersion:'pe-development-consent-v1',privacyVersion:'pe-personal-privacy-v1'};
    const res=await POST(req('POST',input));expect(res.status).toBe(201);expect(JSON.stringify(await res.json())).not.toMatch(/ownerId|example.invalid|draftKey/);
    expect(deps.rpc.mock.calls.find(([name])=>name==='pe_start_guest')?.[1].p_hash).not.toBe(key);
    expect((await POST(req('POST',{...input,ownerId:owner}))).status).toBe(400);
  });
  it('acknowledges only after the report is queued and never returns scores on submission',async()=>{
    const res=await PATCH(req('PATCH',{revision:0,responses,submissionKey:'synthetic_submit_001'}),params);expect(res.status).toBe(202);
    const body=await res.json();expect(body.attempt.result).toBeNull();expect(body.emailStatus).toBe('pending');
    expect(deps.rpc.mock.calls.find(([name])=>name==='pe_queue_guest_report')).toBeTruthy();expect(deps.after).toHaveBeenCalledOnce();
    deps.rpc.mockImplementation(async(name:string)=>({data:name==='pe_guest_attempt'?{...envelope,attempt:{...final,result:null}}:name==='pe_read_participant'?final:true,error:null}));
    expect((await PATCH(req('PATCH',{revision:1,responses,submissionKey:'retry_submit_0001'}),params)).status).toBe(202);
    expect(deps.rpc.mock.calls.filter(([name])=>name==='pe_write_participant')).toHaveLength(1);
  });
  it('records only safe campaign context and never contact details in attribution',async()=>{
    const res=await POST(req('POST',{id,context,draftKey:key,name:'Synthetic name',email:'synthetic@example.invalid',consentVersion:'pe-development-consent-v1',privacyVersion:'pe-personal-privacy-v1',
      attribution:{utmSource:'instagram',utmCampaign:'october',utmTerm:'private@example.invalid'}}));
    expect(res.status).toBe(201);
    expect(deps.rpc).toHaveBeenCalledWith('pe_record_acquisition_context',expect.objectContaining({p_context:{utmSource:'instagram',utmCampaign:'october'}}));
  });
  it('requires a scoped result session for consultation and uses its verified owner, not caller identity',async()=>{
    expect((await resultPATCH(req('PATCH',{action:'request_consultation'}),params)).status).toBe(404);
    expect(deps.rpc).not.toHaveBeenCalled();
    const headers={Cookie:`pe_result_session=${id}.${key}`};
    expect((await resultPATCH(req('PATCH',{action:'request_consultation',ownerId:randomUUID()},headers),params)).status).toBe(400);
    const res=await resultPATCH(req('PATCH',{action:'request_consultation'},headers),params);expect(res.status).toBe(200);
    expect(deps.rpc).toHaveBeenCalledWith('pe_request_consultation',{p_id:id,p_owner:owner});
  });
  it('exchanges a link for an HttpOnly scoped cookie; denies expired links and guessed result access',async()=>{
    const res=await resultPOST(req('POST',{token:key}),params);expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);expect(res.headers.get('set-cookie')).toMatch(/SameSite=lax/i);expect(res.headers.get('set-cookie')).toContain('Max-Age=1800');
    expect((await resultGET(req(),params)).status).toBe(404);
    deps.rpc.mockResolvedValueOnce({data:null,error:{message:'PE_LINK_EXPIRED private SQL'}});
    const expired=await resultPOST(req('POST',{token:key}),params);expect(expired.status).toBe(410);expect(JSON.stringify(await expired.json())).not.toContain('private SQL');
  });
  it('refuses untrusted origins and oversized inputs without querying sensitive data',async()=>{
    expect((await POST(req('POST',{}, {Origin:'https://evil.example.invalid'}))).status).toBe(403);expect(deps.rpc).not.toHaveBeenCalled();
    expect((await resultPOST(req('POST',{token:key,padding:'x'.repeat(17000)}),params)).status).toBe(413);
    expect((await resultGET(req('GET',undefined,{Origin:'https://binahub.id'}),params)).status).toBe(400);
  });
});
afterEach(()=>vi.unstubAllEnvs());
