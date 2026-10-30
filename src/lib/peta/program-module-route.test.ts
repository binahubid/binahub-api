import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const deps=vi.hoisted(()=>({actor:vi.fn(),from:vi.fn(),rpc:vi.fn()}));
vi.mock('@/lib/transformation/auth',()=>({requireTransformationActor:deps.actor}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({from:deps.from,rpc:deps.rpc})}));
import {GET} from '@/app/api/client/program/route';
const actor={role:'client',userId:'user',programId:'program',participantId:'person',accessCodeId:'access'};
let tables:Record<string,unknown>;
beforeEach(()=>{
 vi.clearAllMocks();deps.actor.mockResolvedValue(actor);deps.rpc.mockResolvedValue({data:{status:'in_progress'},error:null});
 tables={engagements:{id:'program',title:'Synthetic program',status:'active',end_date:null,organization:[]},program_modules:[{module_key:'peta',enabled:true},{module_key:'pre_test',enabled:true}],program_questionnaire_submissions:[],lep_responses:null,assessments:null};
 deps.from.mockImplementation((name:string)=>{
  const value=()=>Promise.resolve({data:tables[name],error:null});
  const chain={select:vi.fn(),eq:vi.fn(),not:vi.fn(),order:vi.fn(),limit:vi.fn(),maybeSingle:value,then:(yes:Parameters<Promise<unknown>['then']>[0],no:Parameters<Promise<unknown>['then']>[1])=>value().then(yes,no)};
  for(const key of ['select','eq','not','order','limit'] as const)chain[key].mockReturnValue(chain);
  return chain;
 });
});
const get=()=>GET(new NextRequest('https://api.binahub.id/api/client/program'));
describe('PETA availability in existing program response',()=>{
 it('uses verified participant scope and marks only the submitted PETA module complete',async()=>{
  deps.rpc.mockResolvedValue({data:{status:'submitted'},error:null});const res=await get();expect(res.status).toBe(200);
  expect(deps.rpc).toHaveBeenCalledWith('peta_program_context',{p_actor:'user',p_program:'program',p_participant:'person',p_access:'access'});
  expect((await res.json()).modules).toEqual([{key:'peta',enabled:true,clientAvailable:true,completed:true},{key:'pre_test',enabled:true,clientAvailable:true,completed:false}]);
  expect(res.headers.get('Cache-Control')).toContain('no-store');
 });
 it('does not open PETA before setup succeeds and preserves other modules',async()=>{
  deps.rpc.mockResolvedValue({data:null,error:{message:'PETA_SETUP_REQUIRED'}});
  const body=await (await get()).json();expect(body.modules[0]).toMatchObject({clientAvailable:false,completed:false});expect(body.modules[1].clientAvailable).toBe(true);
 });
 it('never queries PETA for programs without its enabled module',async()=>{
  tables.program_modules=[{module_key:'lep',enabled:true}];await get();expect(deps.rpc).not.toHaveBeenCalled();
 });
 it('denies unverified callers before program/database reads',async()=>{
  deps.actor.mockResolvedValue({error:'denied',status:401});expect((await get()).status).toBe(401);expect(deps.from).not.toHaveBeenCalled();expect(deps.rpc).not.toHaveBeenCalled();
 });
});
