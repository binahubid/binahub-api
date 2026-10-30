import {readFileSync} from 'node:fs';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const deps=vi.hoisted(()=>({rpc:vi.fn(),admin:vi.fn(),limit:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:deps.admin}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:deps.rpc})}));
import {GET,POST,HEAD,maxDuration} from '@/app/api/cron/peta-retention/route';
const secret='synthetic_cron_'+'x'.repeat(48);
function request(method='GET',authorization:string|null='Bearer '+secret){return new NextRequest('https://api.binahub.id/api/cron/peta-retention',{method,headers:authorization?{Authorization:authorization}:{}});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET',secret);deps.rpc.mockResolvedValue({data:0,error:null});vi.spyOn(console,'info').mockImplementation(()=>{});vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
describe('PETA scheduled retention worker',()=>{
 it('registers exactly one monthly job on the first at00UTC/07WIB',()=>{const config=JSON.parse(readFileSync('vercel.json','utf8'));expect(config.crons).toEqual([{path:'/api/cron/peta-retention',schedule:'0 0 1 * *'}]);expect(maxDuration).toBe(60);});
 it('rejects missing/wrong/short credentials, query-string secrets and fake cron user-agents',async()=>{
  for(const auth of [null,'Bearer wrong','Bearer '+'é'.repeat(secret.length)])expect((await GET(request('GET',auth))).status).toBe(401);
  const query=new NextRequest('https://api.binahub.id/api/cron/peta-retention?secret='+secret,{headers:{'User-Agent':'vercel-cron/1.0'}});expect((await GET(query)).status).toBe(401);
  vi.stubEnv('CRON_SECRET','short');expect((await POST(request('POST','Bearer short'))).status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled();
 });
 it('runs GET/POST with no caching and never executes cleanup for HEAD',async()=>{
  for(const method of [GET,POST]){const res=await method(request());expect(res.status).toBe(200);expect(await res.json()).toMatchObject({success:true,erased:0,batches:1,mayHaveMore:false});expect(res.headers.get('cache-control')).toContain('no-store');}
  const before=deps.rpc.mock.calls.length;expect(HEAD().status).toBe(405);expect(deps.rpc.mock.calls.length).toBe(before);
 });
 it('drains full batches, then stops on the first partial batch',async()=>{
  for(const data of [100,100,17])deps.rpc.mockResolvedValueOnce({data,error:null});
  const res=await GET(request());expect(await res.json()).toMatchObject({erased:217,batches:3,mayHaveMore:false});expect(deps.rpc).toHaveBeenCalledTimes(3);for(const call of deps.rpc.mock.calls)expect(call).toEqual(['peta_purge_expired',{p_limit:100}]);
 });
 it('caps a run at1000sessions and explicitly signals possible backlog',async()=>{deps.rpc.mockResolvedValue({data:100,error:null});const res=await GET(request());expect(await res.json()).toMatchObject({erased:1000,batches:10,mayHaveMore:true});expect(deps.rpc).toHaveBeenCalledTimes(10);expect(console.warn).toHaveBeenCalledOnce();});
 it('stops between batches when the20second soft budget is reached',async()=>{vi.spyOn(Date,'now').mockReturnValueOnce(0).mockReturnValue(21000);deps.rpc.mockResolvedValue({data:100,error:null});const res=await GET(request());expect(await res.json()).toMatchObject({erased:100,batches:1,mayHaveMore:true});expect(deps.rpc).toHaveBeenCalledTimes(1);});
 it('reports failure without leaking DB detail and preserves committed-batch counts',async()=>{
  deps.rpc.mockResolvedValueOnce({data:100,error:null}).mockResolvedValueOnce({data:null,error:{message:'PETA_SETUP_REQUIRED PRIVATE_DETAIL '+secret}});
  const res=await GET(request());expect(res.status).toBe(503);const payload=await res.json();expect(payload).toMatchObject({success:false,erased:100,batches:1});expect(JSON.stringify(payload)).not.toMatch(/PRIVATE_DETAIL|synthetic_cron/);expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/PRIVATE_DETAIL|synthetic_cron/);
 });
 it('fails closed on invalid RPC counts instead of falsely claiming success',async()=>{for(const data of [null,'0',-1,101,0.5]){deps.rpc.mockResolvedValueOnce({data,error:null});expect((await GET(request())).status).toBe(503);}});
});
