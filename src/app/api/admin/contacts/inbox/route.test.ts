import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:mocks.limit}));vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:mocks.rpc})}));
import { GET } from './route';
const id='11111111-1111-4111-8111-111111111111';
const req=(params='')=>new NextRequest('https://api.example.invalid/api/admin/contacts/inbox'+params);
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({email:'admin@example.invalid'});mocks.limit.mockResolvedValue(null);mocks.rpc.mockResolvedValue({data:{version:1,total:0,records:[]},error:null});});
describe('contact inbox boundaries, no production services',()=>{
  it.each(['','?id='+id+'&type=lead'])('checks admin/rate before storage %s',async(params)=>{
    mocks.auth.mockResolvedValueOnce({error:'private',status:403});expect((await GET(req(params))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();mocks.limit.mockResolvedValueOnce(new Response(null,{status:429}));expect((await GET(req(params))).status).toBe(429);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes literal search and all filters as RPC parameters with no shared cache',async()=>{
    const response=await GET(req('?'+new URLSearchParams({page:'3',search:'  A,B %_* 東京  ',type:'lead',category:'Lead',status:'Archived'})));expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_contact_inbox',{p_page:3,p_search:'A,B %_* 東京',p_type:'lead',p_category:'Lead',p_status:'Archived'});expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['?page=-1','?page=10001','?page=1.2','?type=unknown','?search=a%00b','?search='+'x'.repeat(151),'?category=a%0Ab','?unknown=x','?page=0&page=1','?id='+id,'?id=nope&type=lead','?id='+id+'&type=lead&page=0'])('rejects invalid or ambiguous input %s',async(params)=>{expect((await GET(req(params))).status).toBe(400);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('loads one typed identity, distinguishing not found from unavailable',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:{id:'lead:'+id,recordId:id},error:null});expect(await(await GET(req('?id='+id+'&type=lead'))).json()).toMatchObject({success:true,record:{id:'lead:'+id}});expect(mocks.rpc).toHaveBeenCalledWith('admin_contact_detail',{p_id:id,p_type:'lead'});
    mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect((await GET(req('?id='+id+'&type=lead'))).status).toBe(404);
  });
  it('never invents empty healthy data or exposes diagnostics',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'PGRST202',message:'private@example.invalid'}});const response=await GET(req());expect(response.status).toBe(503);const body=await response.json();expect(body.error).toContain('SQL84');expect(body).not.toHaveProperty('total');expect(JSON.stringify(body)).not.toContain('private@');
    mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect((await GET(req())).status).toBe(503);
  });
});
