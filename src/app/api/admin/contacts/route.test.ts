import { NextRequest } from 'next/server';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),update:vi.fn(),query:{eq:vi.fn(),select:vi.fn(),single:vi.fn()}}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({from:()=>({update:mocks.update})})}));
import { PATCH } from './route';
const id='11111111-1111-4111-8111-111111111111';
const req=(body:unknown)=>new NextRequest('https://api.example.invalid/api/admin/contacts',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();mocks.auth.mockResolvedValue({email:'admin@example.invalid'});mocks.update.mockReturnValue(mocks.query);mocks.query.eq.mockReturnValue(mocks.query);mocks.query.select.mockReturnValue(mocks.query);mocks.query.single.mockResolvedValue({data:{id},error:null});});
describe('contact notes do not silently change status',()=>{
  it('authenticates before mutation',async()=>{mocks.auth.mockResolvedValueOnce({error:'Denied',status:403});expect((await PATCH(req({id,notes:'Note'}))).status).toBe(403);expect(mocks.update).not.toHaveBeenCalled();});
  it('updates only notes when status was not changed by the admin',async()=>{expect((await PATCH(req({id,notes:'Preserve historical status'}))).status).toBe(200);expect(mocks.update).toHaveBeenCalledWith({notes:'Preserve historical status'});expect(mocks.query.eq).toHaveBeenCalledWith('id',id);});
  it('still requires approved values for an explicit status change',async()=>{expect((await PATCH(req({id,status:'Client',notes:'Chosen explicitly'}))).status).toBe(200);expect(mocks.update).toHaveBeenCalledWith({lead_status:'Client',notes:'Chosen explicitly'});expect((await PATCH(req({id,status:'arbitrary',notes:''}))).status).toBe(400);});
  it('rejects oversized notes and unexpected fields',async()=>{expect((await PATCH(req({id,notes:'x'.repeat(4001)}))).status).toBe(400);expect((await PATCH(req({id,notes:'',sourceType:'coach'}))).status).toBe(400);expect(mocks.update).not.toHaveBeenCalled();});
});
