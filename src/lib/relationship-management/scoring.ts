import 'server-only';
import {z} from 'zod';
import type {RMInstrument} from './instrument';
const responsesSchema=z.record(z.string(),z.union([z.number().int().min(1).max(5),z.enum(['A','B','C','D'])]));
/** Internal, non-persisted preview. Owner approves 50:50 at module level only.
 * No SJT competency weights are inferred from source tags.
 */
export function previewRMReport(source:RMInstrument,input:unknown,requireComplete=false){
 const responses=responsesSchema.parse(input);
 const sr=new Map(source.selfReportItems.map(i=>[i.id,i]));
 const sj=new Map(source.sjtItems.map(i=>[i.id,i]));
 for(const [id,value] of Object.entries(responses)){
  if(sr.has(id)?typeof value!=='number':sj.has(id)?typeof value!=='string':true)throw new Error('RM_RESPONSE_INVALID');
 }
 if(requireComplete&&[...sr.keys(),...sj.keys()].some(id=>!Object.hasOwn(responses,id)))throw new Error('RM_ANSWERS_INCOMPLETE');
 const srValues=source.selfReportItems.map(i=>responses[i.id]);
 const sjValues=source.sjtItems.map(i=>typeof responses[i.id]==='string'?i.scores[responses[i.id] as 'A'|'B'|'C'|'D']:null);
 const round=(value:number)=>Math.round(value*10)/10;
 const selfReport=srValues.every(v=>typeof v==='number')?round(((srValues as number[]).reduce((a,b)=>a+b,0)/srValues.length-1)/4*100):null;
 const sjt=sjValues.every(v=>v!==null)?round((sjValues as number[]).reduce((a,b)=>a+b,0)/(sjValues.length*3)*100):null;
 const combined=selfReport!==null&&sjt!==null?round((selfReport+sjt)/2):null;
 return {version:source.metadata.version,preview:true as const,combinedScore:combined,
  moduleProfile:{selfReport,sjt,combined,scope:'module' as const,weights:{selfReport:0.5,sjt:0.5},policyVersion:'rm-module-50-50-owner-2026-10-29-v1'},
  notice:'Pratinjau internal. Skor gabungan modul memakai pengalaman nyata dan studi kasus dengan bobot 50:50. Nilai studi kasus per kompetensi dan kategori belum ditetapkan. Bukan laporan final peserta.',
  completeness:{expected:40,answered:Object.keys(responses).length},
  areas:source.competencies.map(c=>{
   const values=source.selfReportItems.filter(i=>i.competencyCode===c.code).map(i=>responses[i.id]).filter((v):v is number=>typeof v==='number');
   const mean=values.length===3?values.reduce((a,b)=>a+b,0)/3:null;
   return {code:c.code,name:c.name,
    selfReport:{validCount:values.length,expectedCount:3,mean,score:mean===null?null:Math.round((mean-1)/4*1000)/10,status:mean===null?'insufficient_data':'scored'},
    sjt:{score:null,status:'weighting_required',answeredTaggedCount:source.sjtItems.filter(i=>i.tags.includes(c.code)&&Object.hasOwn(responses,i.id)).length},
    interpretation:null,combinedScore:null};
  }),
  // Report structure can be tested now, without inventing recommendations or exposing private anchors.
  actionPlan:{days:30,stages:['Fokus perilaku','Opsi pengembangan BinaHub','Praktik di tempat kerja','Evaluasi dan perbaikan lanjutan']},
  solutions:{status:'context_review_required',items:[]},
 };
}
