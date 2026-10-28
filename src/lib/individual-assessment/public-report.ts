import 'server-only';
import {createHash} from 'node:crypto';
/** Presentation-only redaction of legacy snapshots; stored scores and source remain immutable. */
export function publicPEReport<T>(input:T):T {
 if(!input||typeof input!=='object')return input;
 const report=structuredClone(input) as Record<string,unknown>;
 const metadata=report.metadata as Record<string,unknown>|undefined;
 if(metadata?.publicWordingVersion==='pe-public-behavior-v1')return input;
 if(!Array.isArray(report.areas)||!Array.isArray(report.priorities))return input;
 const focus:Record<string,string>={
  'PE-02':'Pilih satu kebiasaan yang ingin Anda perbaiki. Coba langkah kecil, lalu catat apa yang membantu Anda berkembang.',
  'PE-04':'Saat rencana berubah, tentukan hal yang perlu disesuaikan dan sepakati langkah berikutnya dengan pihak terkait.',
  'PE-06':'Saat tuntutan meningkat, susun prioritas, periksa kapasitas Anda, dan bicarakan dukungan yang diperlukan.',
 };
 for(const list of [report.areas,report.priorities])for(const area of list){
  if(!area||typeof area!=='object')continue;
  const text=focus[area.code]||'Pilih satu situasi nyata untuk berlatih dan mintalah umpan balik dari orang yang terlibat.';
  if(area.practice)area.practice={focus:text,context:'Pilih satu situasi nyata minggu ini untuk mencoba langkah tersebut.',successIndicator:'Catat tindakan dan hasil yang dapat diamati, lalu mintalah umpan balik.',followUp:'Latih kemampuan ini mulai sekarang, tinjau kembali kompetensi Anda dalam waktu satu bulan ke depan.'};
  if('interpretation' in area)area.interpretation=area.practice?text:'Bukti belum cukup untuk menampilkan skor.';
 }
 report.metadata={...metadata,publicWordingVersion:'pe-public-behavior-v1',presentationVersion:'pe-legacy-redacted-v1'};
 delete report.integrity;
 return {...report,integrity:createHash('sha256').update(JSON.stringify(report)).digest('hex')} as T;
}
