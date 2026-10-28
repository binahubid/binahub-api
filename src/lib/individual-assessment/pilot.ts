import 'server-only';
import {publicPEReport} from './public-report';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PEDeliveryAttemptSchema, PE_REVIEW_CONSENT_VERSION, PEChannelSchema, PE_FREE_CODES } from './delivery-contracts';
import { PEDeliveryError, buildPEDevelopmentReport, loadPEPersonalSolutions } from './delivery';
import { loadPEInstrument, getPEParticipantDefinition } from './definition';
import type { PEReportSnapshot } from './report';

export const PEReviewAccessSchema=z.object({shared:z.boolean(),evaluationConsent:z.boolean(),
  exportConsent:z.boolean().optional(),
  clarity:z.number().int().min(1).max(5).nullable(),usefulness:z.number().int().min(1).max(5).nullable()}).strict();
export const PEReviewUpdateSchema=z.object({share:z.boolean(),consentVersion:z.literal(PE_REVIEW_CONSENT_VERSION).nullable(),
  evaluationVersion:z.literal('pe-evaluation-v2').optional(),
  evaluate:z.boolean(),clarity:z.number().int().min(1).max(5).nullable().default(null),
  usefulness:z.number().int().min(1).max(5).nullable().default(null)}).strict();
export const PEPilotStateSchema=z.object({status:z.enum(['collecting','paused','completed']),revision:z.number().int().nonnegative()}).strict();
const count=z.number().int().nonnegative(), score=z.number().min(0).max(100).nullable();
export const PEPilotDashboardSchema=z.object({status:PEPilotStateSchema.shape.status,revision:count,ready:z.boolean(),
  counts:z.object({started:count,submitted:count,drafts:count,shared:count}).strict(),evaluationSampleSize:count,
  minimumAggregateSize:z.literal(5),areas:z.array(z.object({code:z.enum(['PE-02','PE-04','PE-06']),selfReportMean:score,
    sjtMean:score,selfReportAvailable:count,meanNACount:z.number().min(0).max(4)}).strict()).max(3),
  feedback:z.object({count,clarityMean:z.number().min(1).max(5).nullable(),usefulnessMean:z.number().min(1).max(5).nullable()}).strict(),
  interpretation:z.literal('development_pilot_not_validated')}).strict();
export const PECaseListSchema=z.array(z.object({id:z.uuid(),status:z.enum(['draft','submitted']),createdAt:z.iso.datetime({offset:true}),
  role:z.string(),goal:z.string(),channel:PEChannelSchema}).strict()).max(20);
export const PEHistorySchema=z.array(z.object({id:z.uuid(),status:z.enum(['draft','submitted']),createdAt:z.iso.datetime({offset:true}),
  retentionUntil:z.iso.datetime({offset:true}),answeredCount:count.max(18)}).strict()).max(10);

export async function pePilotRPC(db:Pick<SupabaseClient,'rpc'>,name:string,args:Record<string,unknown>={}) {
  try {
    const {data,error}=await db.rpc(name,args);
    if(error){
      if(['PGRST202','42883','42P01','PGRST205'].includes(error.code||''))throw new PEDeliveryError('PE_PILOT_SETUP_REQUIRED');
      const code=/\bPE_[A-Z_]+\b/.exec(error.message||'')?.[0];
      throw new PEDeliveryError(code&&['PE_ATTEMPT_NOT_FOUND','PE_REVISION_CONFLICT','PE_PILOT_PAUSED',
        'PE_PILOT_SETUP_REQUIRED','PE_DELIVERY_SETUP_REQUIRED','PE_INVALID_REQUEST','PE_CONSENT_REQUIRED',
        'PE_START_CONFLICT','PE_RESULT_NOT_READY','PE_INVALID_REPORT','PE_LINK_EXPIRED','PE_EVALUATION_SAMPLE_SMALL','PE_EXPORT_LIMIT'].includes(code)?code:'PE_SERVICE_UNAVAILABLE');
    }
    return data;
  }catch(error){if(error instanceof PEDeliveryError)throw error;throw new PEDeliveryError('PE_SERVICE_UNAVAILABLE');}
}
export async function getPEReviewAccess(db:SupabaseClient,id:string,owner:string) {
  return PEReviewAccessSchema.parse(await pePilotRPC(db,'pe_owner_review_access',{p_id:id,p_owner:owner}));
}
export async function updatePEReviewAccess(db:SupabaseClient,id:string,owner:string,input:z.infer<typeof PEReviewUpdateSchema>) {
  return PEReviewAccessSchema.parse(await pePilotRPC(db,input.evaluationVersion?'pe_update_review_access_v2':'pe_update_review_access',{
    p_id:id,p_owner:owner,p_share:input.share,p_consent_version:input.consentVersion,p_evaluate:input.evaluate,
    p_clarity:input.clarity,p_usefulness:input.usefulness,
    ...(input.evaluationVersion?{p_evaluation_version:input.evaluationVersion}:{})}));
}
export async function loadPEReportView(db:SupabaseClient,attempt:z.infer<typeof PEDeliveryAttemptSchema>) {
  const instrument=await loadPEInstrument(db,attempt.result?.instrumentVersion);
  const frozen=attempt.status==='submitted'?await db.from('pe_report_snapshots').select('snapshot').eq('attempt_id',attempt.id).maybeSingle():null;
  // Preserve the legacy report for old attempts; new reports are frozen at submission.
  const report=attempt.status==='submitted'?((frozen?.data?.snapshot as PEReportSnapshot|undefined)||buildPEDevelopmentReport(attempt,instrument)):null;
  return {instrument,report:report?publicPEReport(frozen?.data?.snapshot?report:{...report,solutions:await loadPEPersonalSolutions(db,report.priorities.map(p=>p.code))}):null};
}
export async function loadPEAdminCase(db:SupabaseClient,id:string) {
  const raw=z.object({attempt:PEDeliveryAttemptSchema,ownerId:z.uuid(),channel:PEChannelSchema}).strict()
    .parse(await pePilotRPC(db,'pe_admin_review_case',{p_id:z.uuid().parse(id)}));
  const {instrument,report}=await loadPEReportView(db,raw.attempt);
  const safe=getPEParticipantDefinition(instrument);
  // The admin receives the same report model as the participant, never the scoring key or rationale.
  const answers=[...safe.selfReportItems,...safe.sjtItems].filter(q=>PE_FREE_CODES.includes(q.competencyCode as typeof PE_FREE_CODES[number])&&Object.hasOwn(raw.attempt.responses,q.id)).map(q=>{
    const answer=raw.attempt.responses[q.id];
    return {id:q.id,areaCode:q.competencyCode,type:q.type,
      prompt:'prompt' in q?q.prompt:q.question,scenario:'scenario' in q?q.scenario:null,
      answer: q.type==='behavioral_self_report'?safe.selfReportScale.find(s=>s.value===answer)?.label||String(answer):
        ('options' in q?q.options.find(o=>o.id===answer)?.text:'')||String(answer)};
  });
  let participant:{name:string|null;email:string|null}={name:null,email:null};
  // Optional account profile, only AFTER DB confirms the owner's explicit review permission.
  try {
    const {data,error}=await db.auth.admin.getUserById(raw.ownerId);
    if(!error&&data.user)participant={name:typeof data.user.user_metadata?.full_name==='string'?data.user.user_metadata.full_name:null,
      email:data.user.email||null};
  }catch{/* Context, answers and result remain available without the profile service. */}
  if(!participant.email){
    const guest=await db.from('pe_guest_contacts').select('name,email').eq('attempt_id',raw.attempt.id).maybeSingle();
    if(guest.data)participant={name:guest.data.name,email:guest.data.email};
  }
  let delivery:{status:string;sentAt:string|null}|null=null;
  try{
    const job=await db.from('pe_report_email_jobs').select('status,sent_at').eq('attempt_id',raw.attempt.id)
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(job.data&&['pending','processing','sent','failed','uncertain'].includes(job.data.status))delivery={status:job.data.status,sentAt:job.data.sent_at};
  }catch{/* The legacy review remains usable while SQL 67 is deployed. */}
  return {id:raw.attempt.id,status:raw.attempt.status,createdAt:raw.attempt.createdAt,submittedAt:raw.attempt.submittedAt,
    retentionUntil:raw.attempt.retentionUntil,context:raw.attempt.context,channel:raw.channel,participant,answers,report,delivery};
}
