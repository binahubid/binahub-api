import React from 'react';
import { Document,Page,Text,View,StyleSheet,renderToBuffer } from '@react-pdf/renderer';
import { type SpinReport,SpinReportSchema } from './report';
const s=StyleSheet.create({page:{padding:42,fontFamily:'Helvetica',fontSize:10,lineHeight:1.55,color:'#24364b'},
 brand:{fontSize:19,color:'#0b2c6b',fontFamily:'Helvetica-Bold',marginBottom:18},title:{fontSize:23,fontFamily:'Helvetica-Bold',color:'#0b2c6b',marginBottom:10},
 h:{fontSize:14,fontFamily:'Helvetica-Bold',color:'#0b2c6b',marginTop:22,marginBottom:8},row:{paddingVertical:8,borderBottomWidth:0.5,borderBottomColor:'#dce2e9'},label:{fontFamily:'Helvetica-Bold',marginBottom:3},
 small:{fontSize:8,color:'#526479',marginTop:10}});
const titles=['Ringkasan eksekutif','Snapshot kebutuhan','Rekomendasi solusi','Opsi dan investasi indikatif','Asumsi dan hal yang perlu dikonfirmasi','Langkah berikutnya'];
const Summary=({label,value}:{label:string;value:string})=><View style={s.row}><Text style={s.label}>{label}</Text><Text>{value}</Text></View>;
export function SpinPDF({report:r}:{report:SpinReport}){return <Document title="Rekomendasi Pengembangan Organisasi" author="BinaHub" creationDate={new Date(r.issuedAt)} modificationDate={new Date(r.issuedAt)}>
 <Page size="A4" style={s.page}><Text style={s.brand}>BinaHub</Text><Text style={s.title}>Laporan Discovery &amp; Rekomendasi Awal</Text><Text>{r.company}</Text><Text style={s.small}>{new Date(r.issuedAt).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})} | Referensi {r.reference}</Text>
 <Text style={s.h}>{titles[0]}</Text>{[['Konteks',r.summary.situation],['Kebutuhan utama',r.summary.problem],['Dampak yang disampaikan',r.summary.impact],['Hasil yang diharapkan',r.summary.outcome]].map(([label,value])=><Summary key={label} label={label} value={value}/>)}
 <Text style={s.h}>{titles[1]}</Text>{r.snapshot.map(row=><Summary key={row.label} {...row}/>)}
 <Text style={s.small}>Dampak dan konsekuensi merefleksikan persepsi responden dan belum diverifikasi secara independen.</Text>
 <Text style={s.h}>{titles[2]}</Text>{r.solutions.length?r.solutions.map(p=><View key={p.code}><Text style={s.label}>{p.name}</Text>{p.evidence.map((e,i)=><View key={i} style={s.row}><Text>Kebutuhan: {e.need}</Text><Text>Fokus pembelajaran: {e.objective}</Text></View>)}{p.components.length>0&&<><Text style={s.label}>Komponen utama</Text>{p.components.map((t,i)=><Text key={i}>{t}</Text>)}</>}{p.outputs.length>0&&<><Text style={s.label}>Output utama</Text>{p.outputs.map((t,i)=><Text key={i}>{t}</Text>)}</>}</View>):<Text>Diskusi bersama konsultan disarankan untuk memperjelas kebutuhan dan menentukan pendekatan yang sesuai.</Text>}
 <Text style={s.h}>{titles[3]}</Text>{r.investments.length?r.investments.map(p=><View key={p.name} style={s.row}><Text style={s.label}>{p.name}</Text><Text>{p.baseAmountIdr===null?'Dibahas saat konsultasi':'Rp'+p.baseAmountIdr.toLocaleString('id-ID')}</Text><Text>Durasi: {p.duration}. Kapasitas: {p.capacity}</Text><Text>Termasuk: {p.included.join(' dan ')}.</Text><Text>{p.note}</Text></View>):<Text>Ruang lingkup dan investasi dibahas saat konsultasi.</Text>}
 <Text style={s.h}>{titles[4]}</Text>{r.confirmations.map((t,i)=><Text key={i} style={s.row}>{t}</Text>)}<Text style={s.small}>{r.taxNote}</Text>
 <Text style={s.h}>{titles[5]}</Text><Text>Validasi ringkasan kebutuhan, konfirmasi ruang lingkup dan indikator, lalu finalisasi proposal bersama.</Text><Text style={s.row}>Preferensi Anda: {r.nextStep}</Text><Text>Kontak BinaHub: admin@binahub.id</Text><Text style={s.small}>{r.disclaimer}</Text>
 <Text style={s.small}>BinaHub | People. Learning. Elevated.</Text>
 </Page></Document>;}
export async function renderSpinPDF(input:unknown){return renderToBuffer(<SpinPDF report={SpinReportSchema.parse(input)}/>);}
