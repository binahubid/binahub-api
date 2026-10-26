import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks=vi.hoisted(()=>({auth:vi.fn(),limit:vi.fn(),read:vi.fn(),rpc:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:mocks.auth}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:mocks.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:mocks.rpc})}));
vi.mock('./meeting',async original=>({...await original<typeof import('./meeting')>(),readMeeting:mocks.read}));
import {GET as read,PATCH as save} from '@/app/api/admin/discovery/[id]/meeting/route';
import {GET as list,POST as create} from '@/app/api/admin/discovery/meetings/route';
const id='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222';
const contact={name:'Synthetic',email:'synthetic@example.invalid',company:'Synthetic',phone:'',role:''};
const checklist={id,source_id:id,contact,answers:{},notes:'',status:'in_progress',revision:0,updated_at:null};
const ctx={params:Promise.resolve({id})};
const req=(body?:unknown,method='GET',origin='https://app.binahub.id')=>new NextRequest('https://api.binahub.id/api/admin/discovery/'+id+'/meeting',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(()=>{vi.resetAllMocks();mocks.limit.mockResolvedValue(null);mocks.auth.mockResolvedValue({error:'Denied',status:403});mocks.read.mockResolvedValue({checklist,original:{role:'R1'},definition:{}});mocks.rpc.mockResolvedValue({data:{...checklist,revision:1,updated_at:'2026-10-26T00:00:00Z'},error:null});});
describe('meeting routes use existing admin boundary, no live services',()=>{
 it('rejects all reads and writes before touching storage for non-admins',async()=>{
  expect((await read(req(),ctx)).status).toBe(403);expect((await save(req({},'PATCH'),ctx)).status).toBe(403);
  expect((await list(req())).status).toBe(403);expect((await create(req({},'POST'))).status).toBe(403);
  expect(mocks.read).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('uses the authenticated actor and server contact/source, not request identity',async()=>{
  mocks.auth.mockResolvedValue({userId:actor,email:'admin@example.invalid'});
  const response=await save(req({revision:0,answers:{industry:'IND1'},notes:'Next step',status:'in_progress'},'PATCH'),ctx);
  expect(response.status).toBe(200);expect(mocks.rpc).toHaveBeenCalledWith('spin_save_meeting',expect.objectContaining({p_actor:actor,p_source_id:id,p_contact:contact,p_answers:{industry:'IND1'}}));
  expect(JSON.stringify(await response.json())).not.toContain('updated_by');
  expect((await save(req({revision:1,answers:{},notes:'',status:'in_progress',p_actor:id},'PATCH'),ctx)).status).toBe(400);
 });
 it('checks origin and size, requires notice for manual creation, sanitizes database errors',async()=>{
  mocks.auth.mockResolvedValue({userId:actor});
  expect((await save(req({revision:0},'PATCH','https://untrusted.invalid'),ctx)).status).toBe(403);expect(mocks.read).not.toHaveBeenCalled();
  expect((await save(req({notes:'x'.repeat(33000)},'PATCH'),ctx)).status).toBe(413);
  expect((await create(req({id,contact,processingNoticeConfirmed:false},'POST'))).status).toBe(400);
  mocks.rpc.mockResolvedValue({error:{message:'SPIN_REVISION_CONFLICT private@example.invalid'}});
  const conflict=await save(req({revision:0,answers:{},notes:'',status:'in_progress'},'PATCH'),ctx);
  expect(conflict.status).toBe(409);expect(JSON.stringify(await conflict.json())).not.toContain('private@example.invalid');
 });
});
