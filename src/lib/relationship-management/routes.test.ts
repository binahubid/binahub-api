import {describe,it,expect,vi,beforeEach} from 'vitest';
import {NextRequest,NextResponse} from 'next/server';
const deps=vi.hoisted(()=>({admin:vi.fn(),limit:vi.fn(),load:vi.fn(),preview:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:deps.admin}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({})}));
vi.mock('@/lib/individual-assessment/http',()=>({peJson:(v:unknown,s=200)=>NextResponse.json(v,{status:s}),readPEBody:(r:NextRequest)=>r.json()}));
vi.mock('./instrument',()=>({loadRMInstrument:deps.load,rmParticipantDefinition:()=>({selfReportItems:[]}),rmReadiness:()=>({canSell:false,sourceLoaded:true})}));
vi.mock('./scoring',()=>({previewRMReport:deps.preview}));
import {GET,POST} from '@/app/api/admin/assessments/individual/relationship-management/route';
beforeEach(()=>{vi.resetAllMocks();deps.admin.mockResolvedValue({userId:'synthetic'});deps.limit.mockResolvedValue(null);deps.load.mockResolvedValue({});deps.preview.mockReturnValue({combinedScore:null});});
describe('RM admin-only preview boundary',()=>{
 it('denies non-admins before loading private content',async()=>{
  deps.admin.mockResolvedValue({error:'Forbidden',status:403});
  for(const handler of [GET,POST])expect((await handler(new NextRequest('http://localhost/api/test'))).status).toBe(403);
  expect(deps.load).not.toHaveBeenCalled();expect(deps.preview).not.toHaveBeenCalled();
 });
 it('honors rate limits without reading the bank',async()=>{
  deps.limit.mockResolvedValue(NextResponse.json({error:'Rate limited'},{status:429}));
  expect((await GET(new NextRequest('http://localhost/api/test'))).status).toBe(429);expect(deps.load).not.toHaveBeenCalled();
 });
 it('returns an internal preview only, not participant persistence or sales',async()=>{
  const result=await POST(new NextRequest('http://localhost/api/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({responses:{}})}));
  expect(result.status).toBe(200);expect((await result.json()).report.combinedScore).toBeNull();
 });
});
