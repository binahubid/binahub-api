import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:mocks.limit}));vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:mocks.rpc})}));
import { GET } from './route';
const req=(query='')=>new NextRequest('https://api.example.invalid/api/admin/sales/priorities'+query);
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({email:'admin@example.invalid'});mocks.limit.mockResolvedValue(null);mocks.rpc.mockResolvedValue({data:{version:1,page:0,pageSize:20,total:0,records:[]},error:null});});
describe('read-only admin priority endpoint',()=>{
  it('authenticates and rate limits before reading storage',async()=>{
    mocks.auth.mockResolvedValueOnce({error:'PRIVATE_AUTH',status:403});expect((await GET(req())).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null,{status:429}));expect((await GET(req())).status).toBe(429);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes literal filters and page through one parameterized read, without shared caching',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{version:1,page:2,pageSize:20,total:60,records:[]},error:null});
    const response=await GET(req('?'+new URLSearchParams({page:'2',search:' A,B %_* 東京 ',view:'followup',kind:'followup'})));
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(mocks.rpc).toHaveBeenCalledWith('admin_sales_priorities',{p_page:2,p_search:'A,B %_* 東京',p_view:'followup',p_kind:'followup'});
  });
  it.each(['?page=-1','?page=10001','?page=1.2','?view=other','?kind=other','?search=x%00y','?search='+'x'.repeat(151),'?page=0&page=1','?unknown=x','?id=any'])('rejects ambiguous or invalid queries %s',async(query)=>{expect((await GET(req(query))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('distinguishes empty from missing functions, mismatched responses and read failures',async()=>{
    expect((await GET(req())).status).toBe(200);for(const data of [null,{version:1,page:1,pageSize:20,total:0,records:[]},{version:1,page:0,pageSize:20,total:-1,records:[]}]){mocks.rpc.mockResolvedValueOnce({data,error:null});expect((await GET(req())).status).toBe(503);}
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'PRIVATE_DATABASE'}});const response=await GET(req());const body=await response.json();expect(response.status).toBe(503);expect(body.error).toContain('SQL86');expect(body).not.toHaveProperty('total');expect(JSON.stringify(body)).not.toContain('PRIVATE_');
  });
});
