import { z } from 'zod';
import { SPIN_CATALOG } from './catalog';
import { quoteSpinCatalogBase } from './commercial';
import { SPIN_DEFINITION, SpinError, spinInternalRules, spinNeeds } from './intake';
import { spinLabel, type SpinAnswers } from './form';
import { buildSpinRecommendationResult } from './recommendation';

export const SpinReportSchema=z.object({version:z.literal('spin-report-v3-v1'),reference:z.string(),issuedAt:z.string().datetime(),company:z.string().max(150),
  summary:z.object({situation:z.string(),problem:z.string(),impact:z.string(),outcome:z.string()}).strict(),
  snapshot:z.array(z.object({label:z.string(),value:z.string()}).strict()),
  solutions:z.array(z.object({code:z.string(),name:z.string(),components:z.array(z.string()),outputs:z.array(z.string()),evidence:z.array(z.object({need:z.string(),objective:z.string()}).strict())}).strict()).max(3),
  investments:z.array(z.object({name:z.string(),baseAmountIdr:z.number().int().positive().nullable(),duration:z.string(),capacity:z.string(),included:z.array(z.string()),note:z.string()}).strict()).max(3),
  confirmations:z.array(z.string()),nextStep:z.string(),bookingUrl:z.string().url().nullable(),
  taxNote:z.string(),disclaimer:z.string(),
}).strict();
export type SpinReport=z.infer<typeof SpinReportSchema>;
export function readSpinReport(value:unknown){const parsed=SpinReportSchema.safeParse(value);if(!parsed.success)throw new SpinError('SPIN_INVALID_REPORT');return parsed.data;}
function catalogSection(text:string,start:string,end:string) {
 const i=text.indexOf(start);if(i<0)return [];
 const content=text.slice(i+start.length);
 const stops=[end,'KOMPETENSI YANG DIKEMBANGKAN','Kompetensi inti:','OUTPUT / DELIVERABLES','Output:','Cocok Untuk:','Model Harga:','Brand Layanan:','Catatan:'];
 const positions=stops.map(marker=>content.toLowerCase().indexOf(marker.toLowerCase())).filter(index=>index>=0);
 // Missing boundary never means publishing the rest of a product's raw source.
 if(!positions.length)return [];
 return content.slice(0,Math.min(...positions)).trim().split('\n').map(v=>v.replace(/^•\s*/, '').trim()).filter(Boolean);
}
function catalogContents(text:string) {
 const components=catalogSection(text,'OVERVIEW / KONTEN','KOMPETENSI YANG DIKEMBANGKAN');
 const outputs=catalogSection(text,'OUTPUT / DELIVERABLES','Cocok Untuk:');
 const compact=/Output:\s*([\s\S]*?)\s*Format:/.exec(text);
 return {components,outputs:outputs.length?outputs:compact?[compact[1].trim()]:[]};
}
export function buildSpinReport(input:{id:string;submittedAt:string;company:string;answers:SpinAnswers;summary:{situation:string;problem:string;impact:string;outcome:string};status:'confirmed'|'edited'|'supplemented';selection:ReturnType<typeof buildSpinRecommendationResult>;bookingUrl?:string}) {
  const {answers:a,selection}=input, rules=spinInternalRules(a,{status:input.status}),needs=spinNeeds(a,input.status);
  const label=(k:string)=>spinLabel(SPIN_DEFINITION,a,k);
  const blocked=!['A','B'].includes(rules.fitType)||rules.confidence==='low';
  const candidates=blocked?[]:selection.publicReportDraft.recommendations;
  const confirmations:string[]=[];
  if(blocked||!candidates.length)confirmations.push('Perjelas kebutuhan dan ruang lingkup bersama konsultan sebelum menentukan program.');
  if(rules.fitType==='B')confirmations.push('Dukungan atasan dan kesempatan menerapkan pembelajaran perlu dibahas; pelatihan saja belum tentu mencukupi.');
  if(rules.fitType==='C')confirmations.push('Peran, proses, alat, atau dukungan kerja perlu ditinjau; pelatihan saja tidak dijanjikan menyelesaikan kondisi ini.');
  if(rules.conflicts.length)confirmations.push('Beberapa jawaban perlu diselaraskan bersama sebelum menetapkan ruang lingkup.');
  if(a.countStatus!=='known')confirmations.push('Jumlah peserta dan komposisi kelompok perlu dikonfirmasi.');
  if(!a.location||!a.dates)confirmations.push('Lokasi, jadwal, dan kesiapan pelaksanaan perlu dikonfirmasi.');
  const investments=candidates.map(c=>{
    const p=SPIN_CATALOG.modules.find(p=>p.code===c.solutionCode)!;
    const quote=quoteSpinCatalogBase(needs,{solutionCodes:[p.code],days:a.duration==='one'?1:a.duration==='two'?2:null,batches:1,
      format:a.format||'unknown',additionalNeeds:a.location&&!/^jakarta$/i.test(String(a.location).trim())?['travel']:a.facilities==='needed'||a.facilities==='partial'?['venue']:[]});
    // Estimated headcount is never promoted to a definite base quote.
    const amount=a.countStatus==='known'&&a.location&&['onsite','hybrid'].includes(String(a.deliveryMode))?quote.publicInvestment.baseAmountIdr:null;
    if(amount===null)confirmations.push('Investasi '+p.name+' dibahas sesuai peserta, durasi, dan kebutuhan pelaksanaan.');
    return {name:p.name,baseAmountIdr:amount,duration:label('duration'),capacity:p.capacity,included:quote.publicInvestment.included,note:amount===null?'Ruang lingkup dan investasi dibahas saat konsultasi.':'Investasi dasar satu program, satu batch, sesuai durasi dan kapasitas yang disebutkan. Kebutuhan tambahan dibahas saat konsultasi.'};
  });
  const bookingUrl=input.bookingUrl&&/^https:\/\/(app\.)?cal\.com\//.test(input.bookingUrl)?input.bookingUrl:null;
  return {publicReport:SpinReportSchema.parse({version:'spin-report-v3-v1',reference:input.id,issuedAt:input.submittedAt,company:input.company,summary:input.summary,
    snapshot:[['Konteks','role'],['Bidang usaha','industry'],['Kelompok sasaran','audienceGroups'],['Peserta','participantCount'],['Upaya sebelumnya','priorEfforts'],['Hambatan','barriers'],['Konsekuensi yang dikhawatirkan','implications'],['Manfaat prioritas','benefits'],['Ukuran kemajuan','successMeasures']].map(([title,k])=>({label:title,value:label(k)})),
    solutions:candidates.map(c=>({code:c.solutionCode,name:c.name,...catalogContents(SPIN_CATALOG.modules.find(p=>p.code===c.solutionCode)!.sourceText),evidence:c.fitEvidence.map(e=>({need:e.answer,objective:e.learningObjective}))})),investments,
    confirmations:[...new Set(confirmations)],nextStep:label('nextStep'),bookingUrl,taxNote:'Ketentuan pajak perlu dikonfirmasi.',
    disclaimer:'Dokumen ini adalah rekomendasi awal berdasarkan informasi responden, bukan diagnosis organisasi, asesmen psikometrik, jaminan hasil, atau penawaran final. Indikator, ruang lingkup, dan investasi perlu divalidasi bersama. Hasil program juga dipengaruhi penerapan di pekerjaan, dukungan atasan, dan sistem kerja.'}),
    internal:{...selection.internalConsultant,...rules,catalogVersion:SPIN_CATALOG.catalogVersion,pricingVersion:'spin-catalog-base-ceo-2026-10-22-v1'}};
}
