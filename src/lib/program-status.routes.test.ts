import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const deps=vi.hoisted(()=>({auth:vi.fn(),db:vi.fn()}));
vi.mock('@/lib/transformation/auth',()=>({requireTransformationAdmin:deps.auth,requireTransformationActor:deps.auth}));
vi.mock('@/lib/transformation/service',()=>({getDb:deps.db,createEngagement:vi.fn()}));
vi.mock('@/lib/transformation/access',()=>({getAccessibleProgramIds:async()=>null,transformationErrorResponse:vi.fn()}));
import {GET} from '@/app/api/engagements/route';
import {PATCH} from '@/app/api/engagements/[id]/status/route';
let row:Record<string,unknown>,patch:Record<string,unknown>|null;
const updates=vi.fn();
beforeEach(()=>{
 vi.clearAllMocks();deps.auth.mockResolvedValue({role:'admin',userId:'synthetic-admin'});
 row={id:'synthetic-program',status:'in_progress',status_mode:'automatic',start_date:'2020-01-01',end_date:null,engagement_participants:[{count:2}]};patch=null;
 deps.db.mockImplementation(()=>({from:()=>{
  const q={select:()=>q,order:()=>q,limit:()=>q,eq:()=>q,
   update:(value:Record<string,unknown>)=>{updates(value);patch=value;return q;},
   single:async()=>{row={...row,...patch};patch=null;return {data:row,error:null};},
   maybeSingle:async()=>{row={...row,...patch};patch=null;return {data:row,error:null};},
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[row],error:null}).then(resolve)};
  return q;
 }}));
});
describe('manual program status survives a list refresh',()=>{
 it('persists Active as manual and returns the same status on subsequent GETs',async()=>{
  const request=new NextRequest('https://api.binahub.id/api/engagements/synthetic-program/status',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({status:'active'})});
  const changed=await PATCH(request,{params:Promise.resolve({id:'synthetic-program'})});expect(changed.status).toBe(200);
  expect(updates).toHaveBeenCalledWith(expect.objectContaining({status:'active',status_mode:'manual'}));
  for(let i=0;i<2;i++) expect((await (await GET(new NextRequest('https://api.binahub.id/api/engagements'))).json()).engagements[0]).toMatchObject({status:'active',status_mode:'manual',participants:2});
  expect(updates).toHaveBeenCalledTimes(1);
 });
 it('still advances automatic programs with elapsed start dates',async()=>{
  row.status='active';const response=await GET(new NextRequest('https://api.binahub.id/api/engagements'));
  expect((await response.json()).engagements[0].status).toBe('in_progress');expect(updates).toHaveBeenCalledTimes(1);
 });
});
