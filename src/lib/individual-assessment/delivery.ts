import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPEParticipantDefinition,loadPEInstrument,PE_VERSION } from './definition';
import { PEDeliveryAttemptSchema,PE_FREE_CODES,PE_POLICY_ID,PE_CONSENT_VERSION,PE_PRIVACY_VERSION,
  type PEDeliveryAttempt,PEStartSchema,PEWriteSchema } from './delivery-contracts';
import type { PEInstrument } from './instrument-contract';
import { z } from 'zod';

export class PEDeliveryError extends Error {
  constructor(public readonly code:string) {super(code);this.name='PEDeliveryError';}
}
export async function getPEDeliveryDefinition(db:SupabaseClient) {
  const instrument=await loadPEInstrument(db);
  const {data:policy,error}=await db.from('pe_delivery_policies').select('id,instrument_version,release_status,free_codes,content_review,consent_version,privacy_version')
    .eq('id',PE_POLICY_ID).maybeSingle();
  if(error||!policy)throw new PEDeliveryError('PE_DELIVERY_SETUP_REQUIRED');
  if(policy.instrument_version!==PE_VERSION||policy.free_codes?.join()!==PE_FREE_CODES.join()
    ||policy.release_status!=='development_pilot'||policy.content_review!=='ceo_reviewed'
    ||policy.consent_version!==PE_CONSENT_VERSION||policy.privacy_version!==PE_PRIVACY_VERSION)throw new PEDeliveryError('PE_DELIVERY_POLICY_MISMATCH');
  return {instrument,definition:projectPEFreeDefinition(instrument)};
}
export function projectPEFreeDefinition(instrument:PEInstrument) {
  const safe=getPEParticipantDefinition(instrument);
  const allowed=new Set<string>(PE_FREE_CODES);
  return {...safe,publicEnabled:true,policyId:PE_POLICY_ID,releaseStatus:'development_pilot',
    consentVersion:PE_CONSENT_VERSION,privacyVersion:PE_PRIVACY_VERSION,
    competencies:safe.competencies.filter(c=>allowed.has(c.code)),
    selfReportItems:safe.selfReportItems.filter(i=>allowed.has(i.competencyCode)),
    sjtItems:safe.sjtItems.filter(i=>allowed.has(i.competencyCode)),
    // No locked questions, response keys, keys/rationales, price or entitled full-report data.
    lockedAreaCount:3,
    notice:'Asesmen ini membantu refleksi dan pengembangan diri. Hasil bukan diagnosis klinis atau dasar tunggal keputusan seleksi/promosi.',
    privacyNotice:'Jawaban dan hasil hanya tersedia bagi akun Anda. Hasil tidak otomatis dibagikan ke perusahaan. Data disimpan enam bulan; Anda dapat menghapusnya lebih awal.',
  };
}

export function createPEParticipantStore(db:Pick<SupabaseClient,'rpc'>,ownerId:string) {
  z.uuid().parse(ownerId);
  async function call(name:string,args:Record<string,unknown>) {
    try {
      const {data,error}=await db.rpc(name,{p_owner:ownerId,...args});
      if(error) {
        const code=/\bPE_[A-Z_]+\b/.exec(error.message||'')?.[0];
        const allowed=['PE_ATTEMPT_NOT_FOUND','PE_START_CONFLICT','PE_REVISION_CONFLICT','PE_ATTEMPT_FINALIZED',
          'PE_ANSWERS_INCOMPLETE','PE_ENTITLEMENT_REQUIRED','PE_CONSENT_REQUIRED','PE_DELIVERY_SETUP_REQUIRED',
          'PE_PILOT_PAUSED','PE_PILOT_SETUP_REQUIRED'];
        throw new PEDeliveryError(code&&allowed.includes(code)?code:'PE_STORAGE_UNAVAILABLE');
      }
      return data;
    }catch(error){if(error instanceof PEDeliveryError)throw error;throw new PEDeliveryError('PE_STORAGE_UNAVAILABLE');}
  }
  async function attempt(name:string,args:Record<string,unknown>) {
    const parsed=PEDeliveryAttemptSchema.safeParse(await call(name,args));
    if(!parsed.success)throw new PEDeliveryError('PE_STORAGE_CONTRACT_MISMATCH');
    return parsed.data;
  }
  return {
    async start(input:unknown) {const value=PEStartSchema.parse(input);
      return attempt('pe_start_participant_v2',{p_id:value.id,p_context:value.context,
        p_consent_version:value.consentVersion,p_privacy_version:value.privacyVersion,
        p_sharing_version:value.sharingConsentVersion||null,p_channel:value.channel});},
    async read(id:string){return attempt('pe_read_participant',{p_id:z.uuid().parse(id)});},
    async write(id:string,input:unknown){const value=PEWriteSchema.parse(input);
      return attempt('pe_write_participant',{p_id:z.uuid().parse(id),p_revision:value.revision,
        p_responses:value.responses,p_submit_key:value.submissionKey||null});},
    async erase(id:string){if(await call('pe_erase_participant',{p_id:z.uuid().parse(id)})!==true)throw new PEDeliveryError('PE_STORAGE_UNAVAILABLE');return true;},
  };
}

export function buildPEDevelopmentReport(attempt:PEDeliveryAttempt,instrument:PEInstrument) {
  if(attempt.status!=='submitted'||!attempt.result)throw new PEDeliveryError('PE_RESULT_NOT_READY');
  const areas=attempt.result.competencies.map(row=>{
    const c=instrument.config.competencies.find(c=>c.code===row.code)!;
    const sr=instrument.config.self_report_items.filter(i=>i.competency_code===row.code);
    // Concrete practice uses the participant's SR pattern, never an answer-key rationale.
    const focus=sr.filter(i=>typeof attempt.responses[i.id]==='number')
      .sort((a,b)=>Number(attempt.responses[a.id])-Number(attempt.responses[b.id])||a.id.localeCompare(b.id))[0];
    const action=focus?instrument.key_actions.find(a=>a.code===focus.key_action_code)?.text.replace(/^KA\d{2}\.\d\s*[—–-]\s*/,''):null;
    return {...row,name:c.name,definition:c.definition,relevance:attempt.context.relevance[row.code as typeof PE_FREE_CODES[number]],
      practice:action?{focus:action,context:'Pilih satu situasi kerja nyata minggu ini untuk mempraktikkan perilaku tersebut.',
        successIndicator:'Catat satu contoh tindakan dan mintalah umpan balik dari orang yang terlibat.',followUp:'Tinjau catatan latihan setelah dua minggu.'}:null};
  });
  const relevanceRank={high:2,normal:1,low:0};
  const priorities=areas.filter(a=>a.relevance!=='low'&&a.selfReport.status==='scored'&&a.sjt.status==='scored')
    .sort((a,b)=>relevanceRank[b.relevance]-relevanceRank[a.relevance]
      ||a.sjt.score!-b.sjt.score!||a.selfReport.score!-b.selfReport.score!||a.code.localeCompare(b.code))
    .slice(0,3).map(a=>({code:a.code,name:a.name,
      reason:a.relevance==='high'?'Anda menandai Area ini sebagai sangat relevan dengan pekerjaan Anda.':'Area ini relevan dengan pekerjaan Anda dan memiliki bukti dari kedua metode.',
      practice:a.practice}));
  return {version:'pe-web-development-v1',goal:attempt.context.goal,role:attempt.context.role,areas,priorities,
    methodology:'Skor pengalaman kerja dan respons studi kasus ditampilkan terpisah pada skala 0–100. Angka ini bukan persentase penguasaan atau tingkat kemampuan terverifikasi.',
    priorityExplanation:'Fokus latihan mendahulukan relevansi yang Anda pilih dan kelengkapan kedua metode. Bila setara, pola respons studi kasus lalu pengalaman kerja membantu menentukan urutan. Ini kandidat untuk dibahas, bukan diagnosis kelemahan.',
    notice:'Instrumen digunakan dalam tahap uji pengembangan. Hasil perlu dibaca sesuai konteks pekerjaan dan bukan dasar tunggal keputusan seleksi atau promosi.'};
}

export async function loadPEPersonalSolutions(db:SupabaseClient,priorityCodes:string[]) {
  if(!priorityCodes.length)return {status:'no_priorities',items:[]};
  const crosswalk=await db.from('pe_catalog_crosswalks').select('catalog_code')
    .eq('instrument_id','BINAINSIGHTS-PE-V1').eq('instrument_version',PE_VERSION).eq('status','approved').in('pe_code',priorityCodes);
  if(crosswalk.error)return {status:'unavailable',items:[]};
  const codes=(crosswalk.data||[]).map(c=>c.catalog_code);
  if(!codes.length)return {status:'no_matches',items:[]};
  const links=await db.from('catalog_module_competencies').select('module_id')
    .eq('framework_id','signature-2026-competency-v1').eq('role','core').in('competency_code',codes);
  if(links.error)return {status:'unavailable',items:[]};
  const ids=[...new Set((links.data||[]).map(l=>l.module_id))];
  if(!ids.length)return {status:'no_matches',items:[]};
  const modules=await db.from('catalog_modules').select('module_code,slug,name,description,catalog_products!inner(product_key,status,public_visible)')
    .in('id',ids).eq('active',true).eq('is_mock',false).eq('readiness_status','ready').eq('public_visible',true)
    .eq('catalog_products.product_key','signature-self').eq('catalog_products.status','ready').eq('catalog_products.public_visible',true)
    .order('module_code').limit(3);
  if(modules.error)return {status:'unavailable',items:[]};
  return {status:modules.data?.length?'available':'no_matches',items:(modules.data||[]).map(m=>({
    title:m.name,description:m.description||'',url:`https://binahub.id/id/pricing/?solution=${encodeURIComponent(m.module_code)}`,
    reason:'Solusi pengembangan individu yang terhubung dengan kandidat fokus latihan Anda. Kesesuaian program dapat dibahas bersama konsultan.',
  }))};
}
