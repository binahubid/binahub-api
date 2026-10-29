import 'server-only';
import {z} from 'zod';
import type {RMInstrument} from './instrument';
const responsesSchema=z.record(z.string(),z.union([z.number().int().min(1).max(5),z.enum(['A','B','C','D'])]));
/** Internal, non-persisted preview. RM v4 does not approve SJT weights or a composite.
 * PE's temporary 50:50 display rule must never bleed into RM.
 */
export function previewRMReport(source:RMInstrument,input:unknown){
 const responses=responsesSchema.parse(input);
 const sr=new Map(source.selfReportItems.map(i=>[i.id,i]));
 const sj=new Map(source.sjtItems.map(i=>[i.id,i]));
 for(const [id,value] of Object.entries(responses)){
  if(sr.has(id)?typeof value!=='number':sj.has(id)?typeof value!=='string':true)throw new Error('RM_RESPONSE_INVALID');
 }
 return {version:source.metadata.version,preview:true as const,combinedScore:null,
  notice:'Pratinjau internal. Skor studi kasus, skor gabungan dan kategori belum ditetapkan. Bukan laporan final peserta.',
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
