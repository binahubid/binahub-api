import { createHash,createHmac } from 'node:crypto';
import { z } from 'zod';
import source from '@/data/spin-questions-v3.2.json';
import { SPIN_NOTICE_VERSION, spinArray, spinConflicts, spinErrors, spinFit, spinLabel, spinPersonalPattern, spinSanitize, spinSummary, type SpinAnswers, type SpinDefinition } from './form';
export const SPIN_DEFINITION = source as SpinDefinition;
export const SpinKey = z.string().regex(/^[a-f0-9]{64}$/);
export const SpinAnswerSchema = z.record(z.string(), z.union([z.string().max(500), z.number().finite(), z.array(z.string().max(50)).max(10)]));
export const SpinContactSchema=z.object({name:z.string().trim().min(1).max(100),email:z.email().trim().toLowerCase().max(254),company:z.string().trim().min(1).max(150),role:z.string().trim().max(100).default(''),phone:z.string().trim().max(30).regex(/^[0-9+ ().-]*$/).default('')}).strict().refine(c=>![c.name,c.email,c.company,c.role,c.phone].some(v=>/[\r\n]/.test(v)));
export const SpinWriteSchema=z.object({key:SpinKey,revision:z.number().int().nonnegative(),answers:SpinAnswerSchema,
  confirmation:z.object({hash:SpinKey,status:z.enum(['confirmed','edited','supplemented']),corrections:z.partialRecord(z.enum(['situation','problem','impact','outcome']),z.string().trim().max(1000)).default({})}).strict().nullable().default(null),
  submit:z.object({idempotencyKey:SpinKey,contact:SpinContactSchema,processingConsent:z.literal(true),marketingConsent:z.boolean(),noticeVersion:z.literal(SPIN_NOTICE_VERSION),conflictsAcknowledged:z.boolean(),challengeAnswer:z.number().int(),website:z.literal('')}).strict().optional(),
}).strict();
export class SpinError extends Error {constructor(readonly code:string){super(code);}}
export const spinHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function spinChallenge(id:string){
 const secret=process.env.PROPOSAL_LINK_SECRET;if(!secret||secret.length<32)throw new SpinError('SPIN_SETUP_REQUIRED');
 const digest=createHmac('sha256',secret).update('spin/challenge/v1/'+z.uuid().parse(id)).digest();
 const first=digest[0]%8+2,second=digest[1]%8+2;
 return {label:'Berapa '+first+' + '+second+'?',answer:first+second};
}
export function validateSpinAnswers(raw:SpinAnswers,complete=false) {
  const keys=new Set([...SPIN_DEFINITION.fields.map(f=>f.key),'showSpiritual']);
  if(Object.keys(raw).some(k=>!keys.has(k)))throw new SpinError('SPIN_INVALID_REQUEST');
  if(raw.showSpiritual!==undefined&&raw.showSpiritual!=='yes')throw new SpinError('SPIN_INVALID_REQUEST');
  const answers=spinSanitize(SPIN_DEFINITION,raw),errors=spinErrors(SPIN_DEFINITION,answers,complete);
  if(Object.keys(errors).length)throw new SpinError('SPIN_ANSWERS_INVALID');
  return answers;
}
export function summaryHash(answers:SpinAnswers) {
  const selected:SpinAnswers={};
  for(const f of SPIN_DEFINITION.fields)if(Number(f.questionId.slice(1))<=15&&answers[f.key]!==undefined)selected[f.key]=answers[f.key];
  return spinHash(JSON.stringify(selected));
}
export function validateSpinWrite(raw:unknown) {
  const value=SpinWriteSchema.parse(raw), answers=validateSpinAnswers(value.answers,!!value.submit),hash=summaryHash(answers);
  if(value.confirmation) {
    const required=spinErrors(SPIN_DEFINITION,answers,true,Array.from({length:15},(_,i)=>'Q'+String(i+1).padStart(2,'0')));
    if(Object.keys(required).length||value.confirmation.hash!==hash)throw new SpinError('SPIN_SUMMARY_CHANGED');
    if(Object.values(value.confirmation.corrections).some(x=>spinPersonalPattern.test(x)))throw new SpinError('SPIN_ANSWERS_INVALID');
    if(value.confirmation.status==='confirmed'&&Object.keys(value.confirmation.corrections).length)throw new SpinError('SPIN_INVALID_REQUEST');
    if(value.confirmation.status!=='confirmed'&&!Object.values(value.confirmation.corrections).some(Boolean))throw new SpinError('SPIN_ANSWERS_INVALID');
  }
  if(value.submit&&(!value.confirmation||spinConflicts(answers).length&&!value.submit.conflictsAcknowledged))throw new SpinError('SPIN_CONFIRMATION_REQUIRED');
  const base=spinSummary(SPIN_DEFINITION,answers);
  const summary=value.confirmation?{...base}:null;
  if(summary&&value.confirmation)for(const [key,text]of Object.entries(value.confirmation.corrections)){
    if(!text?.trim())continue;
    const k=key as keyof typeof base;
    summary[k]=value.confirmation.status==='supplemented'?base[k]+' Tambahan: '+text:text;
  }
  return {...value,answers,summary};
}
export function spinInternalRules(a:SpinAnswers,confirmation:{status:string}) {
  const fits=spinFit(a),conflicts=spinConflicts(a);
  // Engineering precedence: unclear/conflicting > strategic > system > application > capability.
  const primary=conflicts.length?'E':fits[0];
  const low=primary==='E'||confirmation.status!=='confirmed';
  const signals=[a.priority==='high'||['1','1_3'].includes(String(a.timeline)),
    ['decision_maker','sponsor'].includes(String(a.decisionRole)),
    ['available','proposed'].includes(String(a.budget)),
    a.impactWeight==='significant'||['units','organization'].includes(String(a.impactScope))];
  const signalCount=signals.filter(Boolean).length;
  return {ruleVersion:'spin-rules-conservative-v1',fitType:primary,secondaryFit:fits.filter(x=>x!==primary).slice(0,1),
    confidence:low?'low':['A','B'].includes(primary)?'high':'medium',
    buyingSignals:signals,signalCount,leadTemperature:signalCount>=3&&['confirmed','edited'].includes(confirmation.status)?'hot':signalCount>=2?'warm':'cold',conflicts};
}
export function spinNeeds(a:SpinAnswers,status:'confirmed'|'edited'|'supplemented') {
  const label=(k:string)=>spinLabel(SPIN_DEFINITION,a,k);
  const evidence: {id:string;text:string}[]=[];
  for(const [key,id] of [['problemCluster','Q04'],['symptoms','Q05'],['desiredOutcome','Q13'],['effects','Q07'],['barriers','Q09'],['benefits','Q14'],['successMeasures','Q15']] as const)
    if(a[key]!==undefined&&!(key==='desiredOutcome'&&a.outcomeHelp==='help'))evidence.push({id,text:label(key).slice(0,500)});
  const audience=spinArray(a,'audienceGroups');
  return {summaryStatus:status,problemCluster:a.problemCluster,audience:audience.length===1?audience[0]:'mixed',
    participantCount:typeof a.participantCount==='number'?a.participantCount:null,programScope:a.programScope,
    spiritualOptIn:a.spiritualOptIn||'unknown',barriers:spinArray(a,'barriers').filter(k=>/^B[1-7]$/.test(k)),
    priorOutcome:a.priorOutcome||'none',conflicts:spinConflicts(a),evidence};
}

/** A client confirms the reviewed summary by clicking Confirm & continue,
 * including corrections/additions. Verify that snapshot before using it for AI.
 * The original confirmation status remains available to conservative report rules.
 */
export function spinConfirmedNeeds(answers:SpinAnswers,confirmation:unknown,summary:unknown) {
 const checked=validateSpinWrite({key:'0'.repeat(64),revision:0,answers,confirmation});
 if(!checked.confirmation||!checked.summary||!summary||typeof summary!=='object')throw new SpinError('SPIN_CONFIRMATION_REQUIRED');
 for(const key of ['situation','problem','impact','outcome'] as const)
  if((summary as Record<string,unknown>)[key]!==checked.summary[key])throw new SpinError('SPIN_SUMMARY_CHANGED');
 const needs=spinNeeds(checked.answers,'confirmed');
 const refs={situation:'Q02',problem:'Q05',impact:'Q07',outcome:'Q13'} as const;
 for(const [key,id] of Object.entries(refs) as Array<[keyof typeof refs,string]>) {
  if(!checked.confirmation.corrections[key]?.trim())continue;
  needs.evidence=needs.evidence.filter(item=>item.id!==id);
  needs.evidence.push({id,text:checked.summary[key].slice(0,500)});
 }
 return needs;
}
