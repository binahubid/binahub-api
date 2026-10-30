import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomUUID} from 'node:crypto';
const deps=vi.hoisted(()=>({admin:vi.fn(),participant:vi.fn(),limit:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/admin-auth',()=>({requireAdmin:deps.admin}));
vi.mock('@/lib/transformation/auth',()=>({requireTransformationActor:deps.participant}));
vi.mock('@/lib/rate-limit',()=>({enforceRateLimit:deps.limit}));
vi.mock('@/lib/supabase',()=>({createServerSupabase:()=>({rpc:deps.rpc,from:deps.from})}));
import {GET,POST,PUT} from '@/app/api/peta/[[...path]]/route';
import {POST as purge} from '@/app/api/cron/peta-retention/route';
import {syntheticPeta} from './synthetic';
import {sealKey} from '../../../scripts/lib/peta-source.mjs';
const {pub,priv}=syntheticPeta(),secret='a'.repeat(64),sealed=sealKey(pub,priv,secret),id=randomUUID(),actor=randomUUID();
const token='b'.repeat(64),csrf='c'.repeat(64),cookie='peta_session='+token+'; peta_csrf='+csrf;
const session={id,status:'in_progress',revision:0,participantCode:'SYNTHETIC',instrumentVersion:'1.0.0-pilot',retentionUntil:'2027-10-29T00:00:00Z',submittedAt:null,reviewConsent:true,privacyReference:'Synthetic approved policy',consentVersion:'peta-privacy-v1',blocks:pub.blocks,answers:{},privateKey:'NEVER_PUBLIC'};
const report={participantCode:'SYNTHETIC',submittedAt:'2026-10-29T00:00:00Z',retentionUntil:'2027-10-29T00:00:00Z',result:{instrumentVersion:'1.0.0-pilot',method:'forced_choice_most_least_net_v1',rows:[...'DISC'].map(d=>({dimension:d,most:6,least:6,net:0})),topDimensions:[...'DISC'],topIsTied:true,closeTopScores:true,qualityFlags:['NEVER_PUBLIC']}};
const req=(method='GET',value?:unknown,headers:Record<string,string>={})=>new NextRequest('https://api.binahub.id/api/peta',{method,headers:{Origin:'https://app.binahub.id','Content-Type':'application/json',...headers},...(value!==undefined?{body:JSON.stringify(value)}:{})});
const ctx=(path:string)=>({params:Promise.resolve({path:path.split('/')})});
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('PETA_ENCRYPTION_KEY',secret);deps.admin.mockResolvedValue({userId:actor});deps.participant.mockResolvedValue({role:'client',userId:actor,programId:id,participantId:id,accessCodeId:id});deps.limit.mockResolvedValue(null);deps.rpc.mockImplementation(async(name:string)=>({data:name==='peta_credential_scope'?{programId:null,participantId:null,accessId:null}:name==='peta_program_open'||name==='peta_redeem'||name==='peta_read_session'||name==='peta_save_answer'?session:name==='peta_read_result'?report:name==='peta_submit'?{status:'submitted',submittedAt:'2026-10-29T00:00:00Z'}:{},error:null}));deps.from.mockImplementation(()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{public_payload:pub,sealed_key:sealed.sealed,key_fingerprint:sealed.keyFingerprint,public_sha256:pub.contentSha256},error:null})}));});
afterEach(()=>vi.unstubAllEnvs());
describe('PETA HTTP trust boundaries',()=>{
 it('uses verified program identity, rejects caller ownership fields, and issues participant-only cookies',async()=>{
  const invalid=await POST(req('POST',{participantId:actor,consentVersion:'peta-program-privacy-v1',consentAccepted:true,reviewConsent:false}),ctx('program/start'));expect(invalid.status).toBe(400);expect(deps.rpc).not.toHaveBeenCalled();
  const res=await POST(req('POST',{consentVersion:'peta-program-privacy-v1',consentAccepted:true,reviewConsent:false}),ctx('program/start'));
  expect(res.status).toBe(201);expect(deps.rpc).toHaveBeenCalledWith('peta_program_open',expect.objectContaining({p_actor:actor,p_program:id,p_participant:id,p_access:id,p_review_consent:false}));expect(res.headers.get('set-cookie')).toContain('HttpOnly');
 });
 it('requires fresh matching program identity even if a PETA cookie is present',async()=>{
  deps.rpc.mockResolvedValue({data:{programId:id,participantId:id,accessId:id},error:null});
  deps.participant.mockResolvedValue({role:'client',userId:actor,programId:actor,participantId:actor,accessCodeId:actor});
  expect((await GET(req('GET',undefined,{Cookie:cookie}),ctx('result'))).status).toBe(401);
  expect(deps.rpc.mock.calls.some(call=>call[0]==='peta_read_result')).toBe(false);
  deps.participant.mockResolvedValue({error:'denied',status:401});
  expect((await GET(req(),ctx('program'))).status).toBe(401);
 });

 it('has no uninvited participant start and denies guessed results without database reads',async()=>{expect((await POST(req('POST',{}),ctx('start'))).status).toBe(400);expect((await GET(req(),ctx('result'))).status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled();});
 it('denies foreign origins and unauthenticated admin access before reading source',async()=>{expect((await POST(req('POST',{token},{Origin:'https://evil.invalid'}),ctx('invitation'))).status).toBe(403);deps.admin.mockResolvedValue({error:'Denied',status:403});expect((await GET(req(),ctx('admin'))).status).toBe(403);expect(deps.rpc).not.toHaveBeenCalled();expect(deps.from).not.toHaveBeenCalled();});
 it('records explicit consent, hashes credentials, and sets same-origin HttpOnly cookies',async()=>{const res=await POST(req('POST',{token,consentVersion:'peta-privacy-v1',consentAccepted:true,reviewConsent:false}),ctx('start'));expect(res.status).toBe(201);expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/);expect(res.headers.get('set-cookie')).toMatch(/SameSite=strict/i);expect(res.headers.get('cache-control')).toContain('no-store');expect(JSON.stringify(await res.json())).not.toContain('NEVER_PUBLIC');const args=deps.rpc.mock.calls[0][1];expect(args.p_hash).not.toBe(token);expect(args.p_credential).toHaveLength(64);expect(args.p_review_consent).toBe(false);});
 it('requires CSRF and revision, rejects same choices and extra caller ownership',async()=>{
  const answer={blockId:'PETA-Q01',most:'A',least:'B'},headers={Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':'0'};
  expect((await PUT(req('PUT',answer,{Cookie:cookie}),ctx('answer'))).status).toBe(401);
  expect((await PUT(req('PUT',{...answer,ownerId:actor},headers),ctx('answer'))).status).toBe(400);
  expect((await PUT(req('PUT',{...answer,least:'A'},headers),ctx('answer'))).status).toBe(422);
  expect((await PUT(req('PUT',answer,headers),ctx('answer'))).status).toBe(200);
 });
 it('takes scoring keys from encrypted server source only; filters result fields',async()=>{
  const res=await POST(req('POST',undefined,{Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':'24','Idempotency-Key':'synthetic_submit_01'}),ctx('submit'));expect(res.status).toBe(200);expect(deps.rpc.mock.calls.find(call=>call[0]==='peta_submit')).toEqual(['peta_submit',expect.objectContaining({p_key:priv.optionToDimension,p_revision:24})]);
  const result=await GET(req('GET',undefined,{Cookie:cookie}),ctx('result'));expect(result.status).toBe(200);expect(JSON.stringify(await result.json())).not.toMatch(/qualityFlags|NEVER_PUBLIC|optionToDimension/);
 });
 it('does not log/return raw database errors; preserves revision conflicts',async()=>{deps.rpc.mockResolvedValue({data:null,error:{message:'PETA_REVISION_CONFLICT PRIVATE_DATABASE_DETAIL'}});const res=await PUT(req('PUT',{blockId:'PETA-Q01',most:'A',least:'B'},{Cookie:cookie,'X-CSRF-Token':csrf,'If-Match':'0'}),ctx('answer'));expect(res.status).toBe(412);expect(JSON.stringify(await res.json())).not.toContain('PRIVATE_DATABASE_DETAIL');});
 it('rejects oversized bodies and unapproved setup before mutation',async()=>{expect((await POST(req('POST',{token,padding:'x'.repeat(17000)}),ctx('invitation'))).status).toBe(413);expect((await POST(req('POST',{name:'X',privacyReference:'Synthetic policy',consultantAccess:true,privacyApproved:false,contentRightsConfirmed:true,pilotAcknowledged:true}),ctx('admin/workspaces'))).status).toBe(400);expect(deps.rpc).not.toHaveBeenCalled();});
 it('requires a dedicated cron secret for bounded retention cleanup',async()=>{vi.stubEnv('CRON_SECRET','d'.repeat(64));expect((await purge(req('POST'))).status).toBe(401);expect(deps.rpc).not.toHaveBeenCalled();deps.rpc.mockResolvedValueOnce({data:0,error:null});const res=await purge(req('POST',undefined,{Authorization:'Bearer '+'d'.repeat(64)}));expect(res.status).toBe(200);expect(deps.rpc).toHaveBeenCalledWith('peta_purge_expired',{p_limit:100});});
});
