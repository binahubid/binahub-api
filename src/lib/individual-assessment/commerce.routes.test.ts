import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const deps=vi.hoisted(()=>({admin:vi.fn(),limit:vi.fn(),rpc:vi.fn(),db:vi.fn(),instrument:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:deps.admin}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:deps.db}));
vi.mock('./definition',()=>({loadPEInstrument:deps.instrument}));
import { GET,PUT } from '@/app/api/admin/assessments/individual/commerce/route';
const actor=randomUUID(),id=randomUUID();
const configuration={name:null,description:null,priceIdr:null,attempts:null,startWithinDays:null,completeWithinDays:null,
  retentionMonths:null,refundPolicy:null,terms:null,reportVersion:null};
const data={revision:0,offerId:id,configuration,areaCodes:['PE-01','PE-03','PE-05'],instrumentVersion:'1.0.0-draft.1',
  matchedCount:0,counts:{pending:0,paid:0,attention:0},orders:[]};
const req=(method='GET',body?:unknown,query='')=>new NextRequest('https://api.example.invalid/api/admin/assessments/individual/commerce'+query,
  {method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{
  vi.clearAllMocks();deps.admin.mockResolvedValue({userId:actor});deps.limit.mockResolvedValue(null);
  deps.db.mockReturnValue({rpc:deps.rpc});deps.rpc.mockResolvedValue({data,error:null});
  deps.instrument.mockResolvedValue({config:{competencies:data.areaCodes.map(code=>({code,name:code,privateKey:'not returned'}))}});
});
describe('commerce administration guards',()=>{
  it('rejects unauthenticated/non-admin access before data and enforces limits',async()=>{
    deps.admin.mockResolvedValueOnce({error:'private',status:403});expect((await GET(req())).status).toBe(403);expect(deps.db).not.toHaveBeenCalled();
    deps.limit.mockResolvedValueOnce(new Response('{}',{status:429}));expect((await PUT(req('PUT',{}))).status).toBe(429);
  });
  it('returns real empty data, safe area labels and explicit not-for-sale readiness',async()=>{
    const response=await GET(req());expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    const body=await response.json();expect(body.dashboard.readiness.canSell).toBe(false);expect(body.dashboard.orders).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/privateKey|scoring_key/);
  });
  it('binds draft changes to admin identity and rejects activation/forged amounts',async()=>{
    expect((await PUT(req('PUT',{revision:0,configuration}))).status).toBe(200);
    expect(deps.rpc.mock.calls[0]).toEqual(['pe_commerce_save_draft',{p_revision:0,p_configuration:configuration,p_actor:actor}]);
    for(const input of [{revision:0,configuration,actorId:randomUUID()},{revision:0,configuration,active:true},
      {revision:0,configuration:{...configuration,priceIdr:0}}])expect((await PUT(req('PUT',input))).status).toBe(400);
  });
  it('uses bound query/status and hides storage diagnostics while identifying SQL69 prerequisite',async()=>{
    expect((await GET(req('GET',undefined,'?status=anything'))).status).toBe(400);
    await GET(req('GET',undefined,'?q=synthetic%40example.invalid&status=paid'));
    expect(deps.rpc.mock.calls.at(-1)).toEqual(['pe_commerce_admin_dashboard',{p_query:'synthetic@example.invalid',p_status:'paid'}]);
    deps.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'private credentials'}});
    const response=await GET(req());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'PE_COMMERCE_SETUP_REQUIRED'});
  });
});
