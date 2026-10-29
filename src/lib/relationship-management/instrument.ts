import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {SupabaseClient} from '@supabase/supabase-js';
import {canonicalJson} from '../individual-assessment/definition';

export const RM_VERSION='4.0.0-draft.1';
const text=z.string().trim().min(1).max(5000);
const code=z.string().regex(/^RM-(07|08|09|10|11|12|13|14|15)$/);
const option=z.enum(['A','B','C','D']);
const schema=z.object({
 metadata:z.object({version:z.literal(RM_VERSION),status:z.literal('draft'),publicEnabled:z.literal(false),
  sources:z.array(z.object({file:text,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).length(2),
  reportSelfReportCount:z.literal(24),bankSelfReportCount:z.literal(27)}).strict(),
 competencies:z.array(z.object({code,name:text,definition:text,behaviorAnchors:z.array(text).min(1),
  candidates:z.array(z.object({code:z.string().regex(/^SS-\d{2}$/),name:text,alignment:text}).strict()).min(1),
  deliveryNote:text,validation:text}).strict()).length(9),
 scale:z.array(z.object({value:z.number().int().min(1).max(5),label:text}).strict()).length(5),
 selfReportItems:z.array(z.object({id:z.string().regex(/^RM-SR-0[1-9]-0[1-3]$/),competencyCode:code,prompt:text,behaviorAnchor:text}).strict()).length(27),
 sjtItems:z.array(z.object({id:z.string().regex(/^RM-SJT-(0[1-9]|1[0-3])$/),title:text,scenario:text,
  options:z.array(z.object({id:option,text}).strict()).length(4),tags:z.array(code).min(1),bestOption:option,
  scores:z.object({A:z.number().int().min(0).max(3),B:z.number().int().min(0).max(3),C:z.number().int().min(0).max(3),D:z.number().int().min(0).max(3)}).strict(),rationale:text}).strict()).length(13),
 // A source tag is NOT an approved weighting rule. No default is inferred.
 scoringPolicy:z.null(),
}).strict().superRefine((source,ctx)=>{
 const fail=()=>ctx.addIssue({code:'custom',message:'RM_SOURCE_INVALID'});
 const codes=source.competencies.map(c=>c.code);
 if(codes.join()!=='RM-07,RM-08,RM-09,RM-10,RM-11,RM-12,RM-13,RM-14,RM-15')fail();
 if(source.scale.map(s=>s.value).join()!=='1,2,3,4,5')fail();
 const ids=[...source.selfReportItems,...source.sjtItems].map(i=>i.id);
 if(new Set(ids).size!==40)fail();
 for(const c of codes)if(source.selfReportItems.filter(i=>i.competencyCode===c).length!==3)fail();
 for(const i of source.sjtItems){
  if(i.options.map(o=>o.id).sort().join()!=='A,B,C,D'||i.scores[i.bestOption]!==3||new Set(i.tags).size!==i.tags.length||i.tags.some(c=>!codes.includes(c)))fail();
 }
});
export type RMInstrument=z.infer<typeof schema>;
export const validateRMInstrument=(value:unknown)=>schema.parse(value);
export const hashRMInstrument=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export async function loadRMInstrument(db:Pick<SupabaseClient,'from'>){
 const {data,error}=await db.from('rm_instrument_versions').select('manifest,bundle_sha256').eq('version',RM_VERSION).maybeSingle();
 if(error&&['42P01','PGRST205'].includes(error.code))return null;
 if(error)throw new Error('RM_SOURCE_UNAVAILABLE');
 if(!data)return null;
 if(hashRMInstrument(data.manifest)!==data.bundle_sha256)throw new Error('RM_SOURCE_HASH_MISMATCH');
 return validateRMInstrument(data.manifest);
}
/** Explicit allowlist: no keys, score credits, rationales, tags or behavior anchors. */
export function rmParticipantDefinition(source:RMInstrument){
 return {instrumentVersion:source.metadata.version,title:'Relationship Management',
  competencies:source.competencies.map(({code,name,definition})=>({code,name,definition})),
  selfReportScale:source.scale.map(({value,label})=>({value,label})),
  selfReportItems:source.selfReportItems.map(({id,prompt})=>({id,prompt,type:'behavioral_self_report' as const})),
  sjtItems:source.sjtItems.map(({id,scenario,options})=>{
   const match=scenario.match(/\s*(Apa (?:tindakan|langkah|respons) terbaik\?)$/i);
   return {id,scenario:match?scenario.slice(0,match.index).trim():scenario,type:'situational_judgment' as const,
    question:match?match[1]:'Apa tindakan yang Anda pilih?',options:options.map(({id,text})=>({id,text}))};
  })};
}
export function rmReadiness(source:RMInstrument|null){
 return {version:RM_VERSION,sourceLoaded:Boolean(source),canSell:false as const,publicEnabled:false as const,
  counts:{competencies:source?.competencies.length||0,selfReport:source?.selfReportItems.length||0,sjt:source?.sjtItems.length||0},
  missing:[...(!source?['Jalankan SQL75 privat untuk memasukkan sumber RM.']:[]),
   'Konfirmasi jumlah soal: bank 27 pengalaman nyata, template laporan masih 24.',
   'Bobot studi kasus ke kompetensi dan minimum respons valid yang disahkan CEO.',
   'Aturan interpretasi dan prioritas berdasarkan dua metode serta konteks peran.',
   'Pembayaran, hak akses, pengiriman laporan dan uji perjalanan berbayar.'],
  reportSections:['Ringkasan eksekutif','Profil sembilan kompetensi','Insight kompetensi terpilih','Prioritas pengembangan','Rencana aksi 30 hari','Opsi pengembangan','Catatan metodologis']};
}
