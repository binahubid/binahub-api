import {NextRequest} from 'next/server';
import {z} from 'zod';
import {PetaSession,PetaReport,PetaToken,PetaChoice,PetaError} from '@/lib/peta/contracts';
import {body,guard,json,rpc,key,hash,db,revision,cookies,source,failure,petaHeaders} from '@/lib/peta/http';
import {programActor,scopedCredential} from '@/lib/peta/program';
export const runtime='nodejs';
type Context={params:Promise<{path?:string[]}>};
async function handle(req:NextRequest,ctx:Context){
 const path=(await ctx.params).path?.join('/')||'',admin=path==='admin'||path.startsWith('admin/');
 try{
  const actor=await guard(req,admin);if(actor instanceof Response){for(const [name,value]of Object.entries(petaHeaders))actor.headers.set(name,value);return actor;}
  if(path==='program'&&req.method==='GET')return json({success:true,...await rpc('peta_program_context',await programActor(req))});
  if((path==='program/start'||path==='program/resume')&&req.method==='POST'){
   const scope=await programActor(req);
   const input=path==='program/start'
    ?z.object({consentVersion:z.literal('peta-program-privacy-v1'),consentAccepted:z.literal(true),reviewConsent:z.boolean()}).strict().parse(await body(req))
    :undefined;
   if(path==='program/resume'&&req.body)z.object({}).strict().parse(await body(req));
   await source();const token=key(),csrf=key();
   const session=PetaSession.parse(await rpc('peta_program_open',{...scope,p_credential:hash(token),p_csrf:hash(csrf),p_invitation:hash(key()),p_consent_version:input?.consentVersion??null,p_review_consent:input?.reviewConsent??false}));
   return cookies(json({success:true,session,csrfToken:csrf},input?201:200),token,csrf);
  }
  if(path==='invitation'&&req.method==='POST'){
   const input=z.object({token:PetaToken}).strict().parse(await body(req));return json({success:true,invitation:await rpc('peta_invitation_info',{p_hash:hash(input.token)})});
  }
  if(path==='start'&&req.method==='POST'){
   const input=z.object({token:PetaToken,consentVersion:z.literal('peta-privacy-v1'),consentAccepted:z.literal(true),reviewConsent:z.boolean()}).strict().parse(await body(req));
   // Verify the encrypted, pinned source before accepting a new session.
   await source();const token=key(),csrf=key();
   const session=PetaSession.parse(await rpc('peta_redeem',{p_hash:hash(input.token),p_credential:hash(token),p_csrf:hash(csrf),p_consent_version:input.consentVersion,p_review_consent:input.reviewConsent}));
   return cookies(json({success:true,session,csrfToken:csrf},201),token,csrf);
  }
  if(path==='session'&&req.method==='GET'){
   const cap=await scopedCredential(req);const session=PetaSession.parse(await rpc('peta_read_session',{p_hash:cap.hash}));return json({success:true,session,csrfToken:cap.csrfToken});
  }
  if(path==='answer'&&req.method==='PUT'){
   const cap=await scopedCredential(req,true),input=z.object({blockId:z.string().regex(/^PETA-Q(0[1-9]|1[0-9]|2[0-4])$/),most:PetaChoice.nullable(),least:PetaChoice.nullable()}).strict().parse(await body(req));
   if(input.most!==null&&input.most===input.least)throw new PetaError('PETA_INVALID_ANSWER');
   const session=PetaSession.parse(await rpc('peta_save_answer',{p_hash:cap.hash,p_csrf:cap.csrfHash,p_revision:revision(req),p_block:input.blockId,p_most:input.most,p_least:input.least}));return json({success:true,session});
  }
  if(path==='submit'&&req.method==='POST'){
   if(req.body)z.object({}).strict().parse(await body(req));
   const cap=await scopedCredential(req,true),idempotency=z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).parse(req.headers.get('idempotency-key'));
   const {mapping}=await source();const result=await rpc('peta_submit',{p_hash:cap.hash,p_csrf:cap.csrfHash,p_revision:revision(req),p_submission:hash(idempotency),p_key:mapping});
   return json({success:true,...z.object({status:z.literal('submitted'),submittedAt:z.string()}).parse(result)});
  }
  if(path==='result'&&req.method==='GET')return json({success:true,report:PetaReport.parse(await rpc('peta_read_result',{p_hash:(await scopedCredential(req)).hash}))});
  if(path==='admin'&&req.method==='GET'){
   const data=await rpc('peta_program_dashboard',{p_actor:actor.actor});let configured=false;try{await source();configured=true;}catch{}
   const {data:programs,error}=await db().from('engagements').select('id,title,code,status,modules:program_modules(module_key,enabled)').order('created_at',{ascending:false}).limit(100);
   if(error)throw new PetaError('PETA_SETUP_REQUIRED');
   return json({success:true,...data,programs:(programs||[]).map(program=>({id:program.id,title:program.title,code:program.code,status:program.status,petaEnabled:program.modules?.some(module=>module.module_key==='peta'&&module.enabled)})),sourceReady:configured});
  }
  if(path==='admin/workspaces'&&req.method==='POST'){
   const input=z.object({programId:z.uuid(),privacyReference:z.string().trim().min(10).max(500),consultantAccess:z.boolean(),privacyApproved:z.literal(true),contentRightsConfirmed:z.literal(true),pilotAcknowledged:z.literal(true)}).strict().parse(await body(req));await source();
   return json({success:true,id:await rpc('peta_program_setup',{p_actor:actor.actor,p_program:input.programId,p_reference:input.privacyReference,p_consultant:input.consultantAccess})},201);
  }
  if(path==='admin/invitations'&&req.method==='POST'){
   const input=z.object({workspaceId:z.uuid(),participantCode:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).strict().parse(await body(req));await source();const token=key();
   const result=await rpc('peta_legacy_invitation_create',{p_actor:actor.actor,p_workspace:input.workspaceId,p_hash:hash(token),p_code:input.participantCode});return json({success:true,...result,invitationPath:'/peta#invite='+token},201);
  }
  if(path==='admin/invitation-revoke'&&req.method==='POST'){
   const input=z.object({id:z.uuid()}).strict().parse(await body(req));await rpc('peta_revoke_invitation',{p_actor:actor.actor,p_id:input.id});return json({success:true});
  }
  if(path==='admin/session-action'&&req.method==='POST'){
   const input=z.object({id:z.uuid(),action:z.enum(['result','recover','revoke','erase']),verified:z.boolean().default(false)}).strict().parse(await body(req));
   const token=input.action==='recover'?key():null;
   const result=await rpc('peta_program_admin_action',{p_actor:actor.actor,p_id:input.id,p_action:input.action,p_hash:token?hash(token):null,p_verified:input.verified});
   return json({success:true,...(input.action==='result'?{report:PetaReport.parse(result)}:result),...(token?{invitationPath:'/peta#invite='+token}:{})});
  }
  return json({success:false,error:'Halaman tidak ditemukan.'},404);
 }catch(error){return failure(error);}
}
export const GET=handle;export const POST=handle;export const PUT=handle;
