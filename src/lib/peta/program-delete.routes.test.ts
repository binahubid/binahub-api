import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const deps=vi.hoisted(()=>({auth:vi.fn(),db:vi.fn(),remove:vi.fn()}));
vi.mock('@/lib/transformation/auth',()=>({requireTransformationAdmin:deps.auth}));
vi.mock('@/lib/transformation/service',()=>({getDb:deps.db}));
import {DELETE} from '@/app/api/engagements/[id]/route';
beforeEach(()=>{vi.clearAllMocks();deps.auth.mockResolvedValue({role:'admin',userId:'synthetic-owner'});});
describe('protect existing PETA history before any program deletion',()=>{
 it.each([false,true])('rejects deletion before removing even empty T-BOS teams (lookup failure=%s)',async(failure)=>{
  deps.db.mockImplementation(()=>({from:(table:string)=>{
   const q={select:()=>q,eq:()=>q,delete:deps.remove,
    then:(resolve:(value:unknown)=>unknown)=>Promise.resolve(table==='peta_workspaces'?{count:failure?null:1,error:failure?{message:'synthetic unavailable'}:null}:{data:table==='tbos_teams'?[{id:'synthetic-empty-team'}]:[],count:0,error:null}).then(resolve)};return q;
  }}));
  const response=await DELETE(new NextRequest('https://api.binahub.id/api/engagements/synthetic',{method:'DELETE'}),{params:Promise.resolve({id:'synthetic'})});
  expect(response.status).toBe(failure?503:409);expect(deps.remove).not.toHaveBeenCalled();
  if(!failure)expect(await response.json()).toMatchObject({code:'PROGRAM_HAS_PETA_HISTORY',canArchive:true});
 });
});
