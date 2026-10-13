import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach,describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const deps=vi.hoisted(()=>({admin:vi.fn(),owner:vi.fn(),limit:vi.fn(),rpc:vi.fn(),db:vi.fn(),from:vi.fn(),profile:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:deps.admin}));
vi.mock('@/lib/auth-role',()=>({getUserFromBearer:deps.owner}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:deps.db}));
import { GET,PATCH } from '@/app/api/admin/assessments/individual/route';
import { PATCH as access } from '@/app/api/assessment/individual/[id]/access/route';
import { GET as history } from '@/app/api/assessment/individual/history/route';
import { PEReviewAccessSchema,loadPEAdminCase } from './pilot';
import { PE_FREE_CODES,PE_POLICY_ID } from './delivery-contracts';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { hashPEInstrument } from './definition';
import { scorePEResponses } from './scoring';

const id=randomUUID(),owner=randomUUID(),now=new Date().toISOString(),bundle=makeSyntheticPEInstrument();
const dashboard={status:'collecting',revision:0,ready:true,counts:{started:0,submitted:0,drafts:0,shared:0},evaluationSampleSize:0,
  minimumAggregateSize:5,areas:[],feedback:{count:0,clarityMean:null,usefulnessMean:null},interpretation:'development_pilot_not_validated'};
const request=(method='GET',body?:unknown,query='')=>new NextRequest(`https://api.example.invalid/api/admin/assessments/individual${query}`,{
  method,headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{
  vi.clearAllMocks();deps.admin.mockResolvedValue({userId:owner,email:'test@example.invalid',role:'admin'});
  deps.owner.mockResolvedValue({user:{id:owner,email_confirmed_at:now}});deps.limit.mockResolvedValue(null);
  deps.db.mockReturnValue({rpc:deps.rpc,from:deps.from,auth:{admin:{getUserById:deps.profile}}});
  deps.rpc.mockImplementation(async(name:string)=>({data:name==='pe_admin_review_cases'?[]:dashboard,error:null}));
  deps.profile.mockResolvedValue({data:{user:{email:'synthetic@example.invalid',user_metadata:{full_name:'Synthetic participant'}}},error:null});
  deps.from.mockImplementation((table:string)=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({error:null,
    data:table==='pe_instrument_versions'?{manifest:bundle,bundle_sha256:hashPEInstrument(bundle)}:
      {id:PE_POLICY_ID,instrument_version:'1.0.0-draft.1',content_review:'ceo_reviewed',release_status:'development_pilot',free_codes:[...PE_FREE_CODES],
        consent_version:'pe-development-consent-v1',privacy_version:'pe-personal-privacy-v1'}})}));
});
describe('PE admin and owner route boundaries',()=>{
  it('denies non-admin before data/profile access, rate limits authorized readers and rejects bad cursors',async()=>{
    deps.admin.mockResolvedValueOnce({error:'PRIVATE AUTH DETAIL',status:403});expect((await GET(request())).status).toBe(403);
    expect(deps.db).not.toHaveBeenCalled();expect(deps.profile).not.toHaveBeenCalled();
    deps.limit.mockResolvedValueOnce(new Response('{}',{status:429}));expect((await GET(request())).status).toBe(429);
    expect((await GET(request('GET',undefined,'?before=invalid'))).status).toBe(400);
  });
  it('returns only aggregate/case contracts and uses authenticated actor on revision-protected pause',async()=>{
    const response=await GET(request());expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({success:true,dashboard,cases:[]});
    expect((await PATCH(request('PATCH',{status:'paused',revision:0}))).status).toBe(200);
    expect(deps.rpc.mock.calls.find(([name])=>name==='pe_set_pilot_state')?.[1]).toMatchObject({p_actor:owner,p_status:'paused',p_revision:0});
    expect((await PATCH(request('PATCH',{status:'paused',revision:0,actorId:randomUUID()}))).status).toBe(400);
  });
  it('hides revoked/not-owned cases and does not load account profile before authorization',async()=>{
    deps.rpc.mockResolvedValueOnce({data:null,error:{message:'PE_ATTEMPT_NOT_FOUND sensitive detail'}});
    const response=await GET(request('GET',undefined,`?id=${id}`));expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive');expect(deps.profile).not.toHaveBeenCalled();
  });
  it('exposes contextual answers and the same report without private scoring keys or locked Area content',async()=>{
    const responses=Object.fromEntries([...bundle.config.self_report_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,4]),
      ...bundle.config.sjt_items.filter(i=>PE_FREE_CODES.includes(i.competency_code as never)).map(i=>[i.id,'A'])]);
    const scores=scorePEResponses(responses,bundle);
    const attempt={id,policyId:PE_POLICY_ID,status:'submitted',revision:1,responses,
      context:{role:'Synthetic role',goal:'Synthetic goal',relevance:{'PE-02':'low','PE-04':'low','PE-06':'low'}},
      result:{instrumentId:'BINAINSIGHTS-PE-V1',instrumentVersion:'1.0.0-draft.1',scoringVersion:'pe-dual-method-v1',policyId:PE_POLICY_ID,
        reportVersion:'pe-web-development-v1',releaseStatus:'development_pilot',contentReview:'ceo_reviewed',priorityVersion:'pe-relevance-evidence-v1',
        completeness:{expectedCount:18,answeredCount:18,naCount:0},competencies:scores.competencies.filter(c=>PE_FREE_CODES.includes(c.code as never))},
      createdAt:now,updatedAt:now,submittedAt:now,retentionUntil:now};
    deps.rpc.mockResolvedValueOnce({data:{attempt,ownerId:owner,channel:'instagram'},error:null});
    const detail=await loadPEAdminCase(deps.db(),id);expect(detail.answers).toHaveLength(18);
    expect(detail.context.goal).toBe('Synthetic goal');expect(detail.report?.areas).toHaveLength(3);
    expect(detail.participant.email).toBe('synthetic@example.invalid');
    expect(JSON.stringify(detail)).not.toMatch(/scoring_key|option_scores|rationales|ownerId|PE-01|PE-03|PE-05/);
  });
  it('binds consent and history to the owner; rejects forged IDs and feedback ranges',async()=>{
    const value={shared:true,evaluationConsent:false,clarity:null,usefulness:null};deps.rpc.mockResolvedValue({data:value,error:null});
    expect((await access(request('PATCH',{share:true,consentVersion:'pe-consultant-review-v1',evaluate:false}),{params:Promise.resolve({id})})).status).toBe(200);
    expect(deps.rpc.mock.calls[0][1]).toMatchObject({p_owner:owner,p_id:id});expect(PEReviewAccessSchema.parse(value)).toEqual(value);
    expect((await access(request('PATCH',{share:true,consentVersion:'pe-consultant-review-v1',evaluate:true,clarity:6}),{params:Promise.resolve({id})})).status).toBe(400);
    deps.rpc.mockResolvedValue({data:[],error:null});expect((await history(request())).status).toBe(200);
    expect(deps.rpc.mock.calls.at(-1)).toEqual(['pe_owner_history',{p_owner:owner}]);
  });
  it('reports missing migration safely rather than leaking database details',async()=>{
    deps.rpc.mockResolvedValue({data:null,error:{code:'PGRST202',message:'PRIVATE SQL DETAIL'}});
    const response=await GET(request());expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('PRIVATE SQL');
  });
});
