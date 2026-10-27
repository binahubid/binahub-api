import React from 'react';
import { Document,Page,Text,View,StyleSheet,renderToBuffer } from '@react-pdf/renderer';
import { type SpinReport,SpinReportSchema } from './report';
import { spinSummaryPoints } from './summary-points';

const s=StyleSheet.create({
 page:{paddingTop:35,paddingBottom:48,paddingHorizontal:36,fontFamily:'Helvetica',fontSize:9,lineHeight:1.5,color:'#24364b'},
 head:{backgroundColor:'#0b2c6b',padding:20,borderRadius:9,marginBottom:18},brand:{fontSize:13,fontFamily:'Helvetica-Bold',color:'#ffffff',marginBottom:12},
 title:{fontSize:23,fontFamily:'Helvetica-Bold',lineHeight:1.2,color:'#ffffff',marginBottom:10},company:{fontSize:11,color:'#e0e9fb'},meta:{fontSize:8,color:'#cfddf7',marginTop:10},
 h:{fontSize:14,fontFamily:'Helvetica-Bold',color:'#0b2c6b',marginBottom:10},sub:{fontSize:10,fontFamily:'Helvetica-Bold',color:'#0b2c6b',marginBottom:5},
 path:{flexDirection:'row',marginBottom:17},pathCell:{width:'33.333%',backgroundColor:'#f1f5fb',padding:12,borderRightWidth:1,borderRightColor:'#ffffff'},pathEnd:{backgroundColor:'#e5eefc'},
 label:{fontFamily:'Helvetica-Bold',fontSize:8,color:'#0b2c6b',marginBottom:6},status:{padding:13,backgroundColor:'#f1f5fb',borderRadius:7,marginBottom:20},
 note:{fontSize:8,color:'#526479',marginTop:6},section:{marginTop:19},programHead:{paddingBottom:10,borderBottomWidth:1,borderBottomColor:'#dce4ef',marginBottom:12},programTitle:{fontSize:17,fontFamily:'Helvetica-Bold',color:'#0b2c6b'},
 row:{flexDirection:'row',gap:18},main:{width:'61%'},aside:{width:'35%',backgroundColor:'#f1f5fb',padding:12,borderRadius:7},
 evidence:{marginBottom:10},objective:{fontSize:8,color:'#526479',marginTop:5},tags:{fontSize:9,color:'#0b2c6b',marginTop:5},
 price:{fontSize:14,lineHeight:1.35,fontFamily:'Helvetica-Bold',color:'#0b2c6b',marginBottom:10},line:{marginBottom:7},rule:{borderBottomWidth:1,borderBottomColor:'#dce4ef',paddingBottom:8,marginBottom:9},
 footer:{position:'absolute',bottom:22,left:36,right:36,fontSize:8,color:'#526479',flexDirection:'row',justifyContent:'space-between'},
 body:{marginBottom:8},snapshot:{marginBottom:10,width:'47%'},snapshots:{flexDirection:'row',flexWrap:'wrap',gap:12},small:{fontSize:8,color:'#526479'},
});
const footer=<Text style={s.footer} fixed render={({pageNumber,totalPages})=>`BinaHub | People. Learning. Elevated.                                      ${pageNumber} / ${totalPages}`}/>;
const brief=(value:string)=>value.length>220?value.slice(0,217).replace(/\s+\S*$/,'')+'...':value;
export function SpinPDF({report:r}:{report:SpinReport}){
 const programs=r.solutions.length?r.solutions:r.exploration||[],review=!r.solutions.length&&programs.length>0;
 const advisory=r.advisory||{title:programs.length?'Arah pengembangan yang direkomendasikan':'Mari perjelas arah pengembangan Anda',description:programs.length?'Program berikut menghubungkan kebutuhan kerja dengan fokus pengembangan.':'Belum ada program yang ditetapkan. Gunakan ringkasan ini untuk memperjelas sasaran dan pendekatan bersama BinaHub.',reasons:[]};
 return <Document title="Rekomendasi Pengembangan Organisasi" author="BinaHub" creationDate={new Date(r.issuedAt)} modificationDate={new Date(r.issuedAt)}>
  <Page size="A4" style={s.page}>
   <View style={s.head}><Text style={s.brand}>BinaHub</Text><Text style={s.title}>Rekomendasi pengembangan organisasi</Text><Text style={s.company}>{r.company}</Text><Text style={s.meta}>{new Date(r.issuedAt).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})} | Referensi {r.reference.slice(0,8).toUpperCase()}</Text></View>
   <Text style={s.h}>Arah pengembangan, dalam satu pandangan</Text>
   <View style={s.path}>{[['Kebutuhan utama',r.summary.problem],['Dampak pada pekerjaan',r.summary.impact],['Hasil yang diharapkan',r.summary.outcome]].map(([label,value],index)=><View key={label} style={index===2?[s.pathCell,s.pathEnd]:s.pathCell}><Text style={s.label}>{label}</Text>{spinSummaryPoints(value).slice(0,3).map(point=><Text key={point} style={s.line}>- {brief(point)}</Text>)}{spinSummaryPoints(value).length>3&&<Text style={s.note}>Rincian lainnya pada bagian konteks kebutuhan.</Text>}</View>)}</View>
   <View style={s.status}><Text style={s.sub}>{advisory.title}</Text><Text>{advisory.description}</Text>{advisory.reasons.map(reason=><Text key={reason} style={s.note}>{reason}</Text>)}</View>
   <Text style={s.h}>{review?'Opsi program untuk konsultasi':'Program yang relevan'}</Text>
   {programs.length?programs.map(program=><View key={program.code} style={s.rule} wrap={false}><Text style={s.sub}>{program.code} | {program.name}</Text>{!!program.competencies?.length&&<Text style={s.tags}>{program.competencies.slice(0,3).join(' / ')}{program.competencies.length>3?' / dan '+(program.competencies.length-3)+' lainnya':''}</Text>}</View>):<Text style={s.body}>Belum ada program yang ditetapkan. Hubungi admin@binahub.id untuk membahas kebutuhan dan sasaran pengembangan.</Text>}
   <Text style={s.note}>Kompetensi merupakan fokus program, bukan hasil pengukuran. Rincian lengkap tersedia pada halaman berikutnya.</Text>{footer}
  </Page>
  {programs.map(program=>{const investment=r.investments.find(item=>item.name===program.name);return <Page key={program.code} size="A4" style={s.page}>
   <View style={s.programHead}><Text style={s.label}>BinaHub | {program.code}</Text><Text style={s.programTitle}>{program.name}</Text><Text style={s.note}>{review?'Opsi program untuk konsultasi':'Rekomendasi awal untuk '+r.company}</Text></View>
   <View style={s.row}><View style={s.main}><Text style={s.h}>Kenapa program ini relevan?</Text>{program.evidence.map((e,index)=><View key={index} style={s.evidence} wrap={false}><Text style={s.label}>Kebutuhan Anda</Text><Text>{e.need}</Text><Text style={s.objective}>Fokus pembelajaran: {e.objective}</Text></View>)}
    {!!program.competencies?.length&&<View style={s.section}><Text style={s.sub}>Kompetensi yang dikembangkan</Text><Text style={s.tags}>{program.competencies.join(' / ')}</Text><Text style={s.note}>Fokus program, bukan hasil pengukuran kompetensi.</Text></View>}
   </View><View style={s.aside}><Text style={s.sub}>{review?'Ruang lingkup untuk dibahas':'Investasi indikatif'}</Text><Text style={s.price}>{investment?.baseAmountIdr!=null?'Rp'+investment.baseAmountIdr.toLocaleString('id-ID'):'Disesuaikan setelah konsultasi'}</Text>
    {investment&&<><Text style={s.line}>Durasi: {investment.duration}</Text><Text style={s.line}>Kapasitas: {investment.capacity}</Text><Text style={s.line}>Termasuk {investment.included.join(' dan ')}.</Text><Text style={s.note}>{investment.note}</Text></>}
    {review&&<Text style={s.note}>Program adalah bagian dari pendekatan pengembangan. Proses, dukungan kerja, dan investasi perlu diselaraskan bersama.</Text>}
   </View></View>
   {program.outputs.length>0&&<View style={s.section}><Text style={s.h}>Hasil yang dibawa pulang</Text>{program.outputs.map(text=><Text key={text} style={s.line}>- {text}</Text>)}</View>}
   {program.components.length>0&&<View style={s.section}><Text style={s.h}>Materi dan komponen program</Text>{program.components.map(text=><Text key={text} style={s.line}>- {text}</Text>)}</View>}{footer}
  </Page>;})}
  <Page size="A4" style={s.page}>
   <View style={s.programHead}><Text style={s.label}>BinaHub | Persiapan pelaksanaan</Text><Text style={s.programTitle}>Rencana tindak lanjut</Text></View>
   <View style={s.row}><View style={s.main}><Text style={s.h}>Sebelum pelaksanaan</Text>{r.confirmations.map(text=><Text key={text} style={s.line}>- {text}</Text>)}<Text style={s.note}>{r.taxNote}</Text></View><View style={s.aside}><Text style={s.sub}>Langkah berikutnya</Text><Text style={s.line}>1. Selaraskan sasaran dan prioritas.</Text><Text style={s.line}>2. Tentukan peserta, ruang lingkup, dan jadwal.</Text><Text style={s.line}>3. Finalisasi proposal dan pelaksanaan.</Text><Text style={s.note}>Preferensi Anda: {r.nextStep}</Text><Text style={s.note}>Hubungi admin@binahub.id</Text>{r.bookingUrl&&<Text style={s.note}>{r.bookingUrl}</Text>}</View></View>
   {footer}
  </Page>
  <Page size="A4" style={s.page}>
   <View style={s.programHead}><Text style={s.label}>BinaHub | Konteks kebutuhan</Text><Text style={s.programTitle}>Ringkasan dan rincian pengisian</Text></View>
   {[['Konteks',r.summary.situation],['Kebutuhan utama',r.summary.problem],['Dampak pada pekerjaan',r.summary.impact],['Hasil yang diharapkan',r.summary.outcome]].map(([label,value])=><View key={label} style={s.evidence}><Text style={s.label}>{label}</Text>{spinSummaryPoints(value).map(point=><Text key={point} style={s.line}>- {point}</Text>)}</View>)}
   <View style={s.snapshots}>{r.snapshot.map(row=><View key={row.label} style={s.snapshot} wrap={false}><Text style={s.label}>{row.label}</Text><Text>{row.value}</Text></View>)}</View>
   <Text style={s.small}>Dampak dan konsekuensi berdasarkan informasi responden, belum diverifikasi secara independen.</Text><Text style={s.note}>{r.disclaimer}</Text>{footer}
  </Page>
 </Document>;
}
export async function renderSpinPDF(input:unknown){return renderToBuffer(<SpinPDF report={SpinReportSchema.parse(input)}/>);}
