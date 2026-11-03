import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:mocks.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:mocks.rpc})}));
import { GET } from './route';
const id='11111111-1111-4111-8111-111111111111';
const req=(params='')=>new NextRequest('https://api.example.invalid/api/admin/pipeline/inbox'+params);
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({email:'admin@example.invalid'});mocks.limit.mockResolvedValue(null);mocks.rpc.mockResolvedValue({data:{version:1,page:0,total:0,records:[]},error:null});});
describe('read-only pipeline endpoint boundaries',()=>{
  it.each(['','?id='+id])('checks admin and rate limits before storage %s',async(params)=>{
    mocks.auth.mockResolvedValueOnce({error:'private',status:403});expect((await GET(req(params))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null,{status:429}));expect((await GET(req(params))).status).toBe(429);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes literal search and exact filters as RPC arguments without shared caching',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{version:1,page:3,total:80,records:[]},error:null});
    const response=await GET(req('?'+new URLSearchParams({page:'3',search:'  A,B %_* 東京  ',view:'active',priority:'attention',owner:'owner@x.invalid',source:'manual_upload',stage:'qualified',sort:'value',tests:'1'})));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_pipeline_inbox',{p_page:3,p_search:'A,B %_* 東京',p_view:'active',p_priority:'attention',p_owner:'owner@x.invalid',p_source:'manual_upload',p_stage:'qualified',p_sort:'value',p_tests:true});
  });
  it.each(['?page=-1','?page=10001','?page=1.2','?view=all','?priority=hot','?stage=won','?sort=AI','?tests=true','?search=a%00b','?search='+'x'.repeat(151),'?owner='+'x'.repeat(321),'?source=a%0Ab','?unknown=x','?page=0&page=1','?id=nope','?id='+id+'&page=0','?id='+id+'&historyPage=-1'])('rejects malformed or ambiguous query %s',async(params)=>{
    expect((await GET(req(params))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('loads only the requested identity and history page',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{record:{id},context:{historyPage:2,activities:[]}},error:null});
    expect(await(await GET(req('?id='+id+'&historyPage=2'))).json()).toMatchObject({success:true,record:{id}});
    expect(mocks.rpc).toHaveBeenCalledWith('admin_pipeline_detail',{p_id:id,p_history_page:2});
    mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect((await GET(req('?id='+id))).status).toBe(404);
  });
  it('does not mask missing migrations, database failures or mismatched data as a healthy empty result',async()=>{
    for(const data of [null,{version:1,page:1,total:0,records:[]},{version:1,page:0,total:-1,records:[]}]){
      mocks.rpc.mockResolvedValueOnce({data,error:null});expect((await GET(req())).status).toBe(503);
    }
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'PRIVATE_DATABASE_DETAIL'}});
    const response=await GET(req());const body=await response.json();expect(response.status).toBe(503);expect(body.error).toContain('SQL85');expect(JSON.stringify(body)).not.toContain('PRIVATE_');expect(body).not.toHaveProperty('total');
    mocks.rpc.mockResolvedValueOnce({data:{record:{id:'other'},context:{historyPage:0,activities:[]}},error:null});expect((await GET(req('?id='+id))).status).toBe(503);
  });
});
