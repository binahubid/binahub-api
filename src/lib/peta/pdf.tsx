import React from 'react';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {Document,Page,Text,View,Image as PDFImage,Font,Svg,Line,Rect,Text as PDFText,StyleSheet,renderToBuffer} from '@react-pdf/renderer';
import {z} from 'zod';
import {PetaIndividualPDFData,PetaGroupReport,PetaError} from './contracts';
import {petaDimensions,petaGroupPattern,petaReportNarrative} from './reporting';

const navy='#0b2c6b',ink='#24364b',muted='#405779',ice='#eef3fa',rule='#dce4ef';
const logo={data:readFileSync(path.join(process.cwd(),'public','brand','binahub-wordmark.png')),format:'png' as const};
Font.register({family:'PetaInter',fonts:[
 {src:path.join(process.cwd(),'public','fonts','Inter-Regular.ttf'),fontWeight:400},
 {src:path.join(process.cwd(),'public','fonts','Inter-SemiBold.ttf'),fontWeight:600},
]});
// The installed layout engine resolves styles again during pagination. Explicit
// lineHeight values compound on those passes, including static body paragraphs.
// Use the embedded font's stable line metrics, then control spacing on Views.
const s=StyleSheet.create({
 page:{paddingTop:38,paddingBottom:58,paddingHorizontal:42,fontFamily:'PetaInter',fontSize:10.5,color:ink},
 brand:{width:116,height:33,objectFit:'contain',marginBottom:16},
 title:{fontSize:22,fontWeight:600,color:navy,letterSpacing:-.35,marginBottom:12},
 compactTitle:{fontSize:20,fontWeight:600,color:navy,letterSpacing:-.3,marginBottom:8},
 name:{fontSize:12,fontWeight:600,color:navy,marginBottom:4},
 meta:{fontSize:9,color:muted,marginBottom:4},header:{paddingBottom:12,borderBottomWidth:1,borderBottomColor:rule,marginBottom:16},
 h:{fontSize:14,fontWeight:600,color:navy,marginBottom:10},sub:{fontSize:11,fontWeight:600,color:navy,marginBottom:6},
 note:{fontSize:8.5,color:muted},body:{marginBottom:12},
 notice:{backgroundColor:ice,padding:12,borderRadius:6,marginBottom:16},noticeTitle:{fontSize:9.5,fontWeight:600,color:navy,marginBottom:6},
 bold:{fontWeight:600},section:{marginTop:20},row:{flexDirection:'row',gap:20},half:{width:'48%'},
 chartTitle:{fontSize:10,fontWeight:600,color:navy,marginBottom:8},tableHead:{flexDirection:'row',alignItems:'center',backgroundColor:ice,paddingVertical:8,paddingHorizontal:12},
 tableRow:{flexDirection:'row',alignItems:'center',paddingVertical:8,paddingHorizontal:12,borderBottomWidth:1,borderBottomColor:rule},
 cell:{width:'25%',fontSize:9.5},numberCell:{width:'25%',fontSize:9.5,textAlign:'right'},
 tableLabel:{width:'80%',fontSize:9.5,paddingRight:12},tableNumber:{width:'20%',fontSize:9.5,textAlign:'right'},
 dimension:{paddingVertical:12,borderBottomWidth:1,borderBottomColor:rule},question:{marginBottom:16},
 reflectionLine:{height:20,borderBottomWidth:.6,borderBottomColor:rule},
 footer:{position:'absolute',bottom:22,left:42,right:42,height:22,borderTopWidth:.6,borderTopColor:rule,paddingTop:8,flexDirection:'row',justifyContent:'space-between'},
 footerLabel:{fontSize:8,color:muted},footerPage:{width:90,height:12,fontSize:8,color:muted,textAlign:'right'},
 coverage:{flexDirection:'row',gap:24,paddingVertical:14,marginBottom:16,borderBottomWidth:1,borderBottomColor:rule},stat:{flex:1},value:{fontSize:24,fontWeight:600,color:navy,marginBottom:6},
 participant:{width:'40%',fontSize:9.5,paddingRight:16},scores:{width:'15%',fontSize:9.5,textAlign:'right'},matrixRow:{flexDirection:'row',alignItems:'center',paddingHorizontal:12,paddingVertical:12,borderBottomWidth:1,borderBottomColor:rule},
});
const date=(value:string)=>new Date(value).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'});
const signed=(n:number)=>n>0?'+'+n:String(n);
const text=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\u2010-\u2015\u2212]/g,'-');
function Footer({internal=false}:{internal?:boolean}){return <View fixed style={s.footer}><Text style={s.footerLabel}>{internal?'Rahasia':'Pribadi'} | PETA - BinaHub</Text><Text style={s.footerPage} render={({pageNumber,totalPages})=>`${pageNumber} / ${totalPages}`}/></View>;}
// The exact original wordmark from the app, embedded locally with no remote fetch.
function Brand(){return <PDFImage src={logo} style={s.brand}/>;}
function Disclaimer(){return <View style={s.notice} wrap={false}><Text style={s.noticeTitle}>Hasil merupakan kecenderungan pribadi/tabiat, bukan ukuran kemampuan/kompetensi.</Text><Text style={s.note}>Pilihan bersifat relatif dalam diri peserta, bukan perbandingan kemampuan antarpeserta, label permanen, atau dasar tunggal seleksi dan promosi. PETA masih dalam tahap uji pengembangan.</Text></View>;}
type Individual=z.infer<typeof PetaIndividualPDFData>;
function Charts({data}:{data:Individual}){
 const rows=data.report.result.rows;
 return <View style={s.row} wrap={false}>
  <View style={s.half}><Text style={s.chartTitle}>Selisih pilihan relatif</Text><Svg viewBox="0 0 300 210" width="100%" height={154}>
   {[-24,-12,0,12,24].map(n=><React.Fragment key={n}><Line x1={148+n*102/24} x2={148+n*102/24} y1={15} y2={180} stroke={n===0?muted:rule}/><PDFText x={148+n*102/24} y={202} style={{fontSize:10}} textAnchor="middle" fill={muted}>{signed(n)}</PDFText></React.Fragment>)}
   {rows.map((r,i)=><React.Fragment key={r.dimension}><PDFText x={5} y={41+i*42} style={{fontSize:12}} fill={navy}>{r.dimension}</PDFText><Rect x={r.net<0?148+r.net*102/24:148} y={25+i*42} width={Math.abs(r.net)*102/24} height={23} rx={2} fill={r.net<0?'#647ca5':navy}/><PDFText x={295} y={41+i*42} textAnchor="end" style={{fontSize:11}} fill={navy}>{signed(r.net)}</PDFText></React.Fragment>)}
  </Svg><Text style={s.note}>Rentang tetap -24 hingga +24. Garis tengah: nol.</Text></View>
  <View style={s.half}><Text style={s.chartTitle}>Frekuensi pilihan per dimensi</Text><Svg viewBox="0 0 300 210" width="100%" height={154}>
   {[0,6,12,18,24].map(n=><React.Fragment key={n}><Line x1={28+n*222/24} x2={28+n*222/24} y1={12} y2={183} stroke={rule}/><PDFText x={28+n*222/24} y={202} style={{fontSize:10}} textAnchor="middle" fill={muted}>{n}</PDFText></React.Fragment>)}
   {rows.map((r,i)=><React.Fragment key={r.dimension}><PDFText x={5} y={37+i*43} style={{fontSize:12}} fill={navy}>{r.dimension}</PDFText>{[r.most,r.least].map((v,j)=><React.Fragment key={j}><Rect x={28} y={19+i*43+j*16} width={v*222/24} height={11} rx={2} fill={j?'#647ca5':navy}/><PDFText x={295} y={28+i*43+j*16} textAnchor="end" style={{fontSize:10}} fill={navy}>{v}</PDFText></React.Fragment>)}</React.Fragment>)}
  </Svg><Text style={s.note}>Atas: paling sesuai. Bawah: paling kurang sesuai.</Text></View>
 </View>;
}
export function PetaIndividualPDF({data}:{data:Individual}){
 return <Document title="Laporan Individu PETA" author="BinaHub" creationDate={new Date(data.issuedAt)}>
  <Page size="A4" style={s.page}><Brand/><View style={s.header}><Text style={s.title}>Peta preferensi perilaku kerja Anda</Text>{data.participantName&&<Text style={s.name}>{text(data.participantName)}</Text>}<Text style={s.meta}>{text(data.programName)}</Text><Text style={s.meta}>Diselesaikan pada {date(data.report.submittedAt)}</Text></View>
   <Disclaimer/><Text style={s.h}>Baca pola Anda secara utuh</Text><Text style={s.body}>{petaReportNarrative(data.report.result)}</Text><Charts data={data}/>
   <View style={s.section} wrap={false}><Text style={s.h}>Rincian angka pilihan</Text><View style={s.tableHead}>{['Dimensi','Paling sesuai','Paling kurang sesuai','Selisih'].map((v,i)=><Text key={v} style={[i?s.numberCell:s.cell,s.bold]}>{v}</Text>)}</View>{data.report.result.rows.map(r=><View key={r.dimension} style={s.tableRow}><Text style={s.cell}>{r.dimension}</Text><Text style={s.numberCell}>{r.most}</Text><Text style={s.numberCell}>{r.least}</Text><Text style={s.numberCell}>{signed(r.net)}</Text></View>)}<Text style={[s.note,{marginTop:10}]}>Selisih = paling sesuai dikurangi paling kurang sesuai. Nilai positif bukan lebih baik; nilai negatif bukan kemampuan yang buruk.</Text></View><Footer/>
  </Page>
  <Page size="A4" style={s.page}><Brand/><View style={s.header}><Text style={s.compactTitle}>Memahami pola, memilih langkah</Text><Text style={s.meta}>{data.participantName?text(data.participantName):'Laporan pribadi'} | {date(data.report.submittedAt)}</Text></View><Text style={s.h}>Empat kecenderungan yang dibaca bersama</Text>
   {Object.entries(petaDimensions).map(([d,value])=><View key={d} style={s.dimension} wrap={false}><Text style={s.sub}>{d} - {value.title}</Text><Text>{value.text}</Text></View>)}
   <View style={s.section}><Text style={s.h}>Bawa hasil ini ke situasi nyata</Text>{['Dalam situasi apa cara kerja ini paling membantu saya?','Kapan saya perlu mencoba pendekatan berbeda?','Langkah konkret apa yang akan saya lakukan dalam dua minggu ke depan?'].map((q,i)=><View style={s.question} key={q} wrap={false}><Text>{i+1}. {q}</Text><View style={s.reflectionLine}/><View style={s.reflectionLine}/></View>)}</View><Text style={s.note}>Cocokkan hasil dengan pengalaman sehari-hari. Cara merespons dapat berubah sesuai situasi; tidak perlu memaksakan satu label diri.</Text><Footer/>
  </Page>
 </Document>;
}
type Group=z.infer<typeof PetaGroupReport>;
export function PetaGroupPDF({data}:{data:Group}){
 const pattern=petaGroupPattern(data.members);
 return <Document title="Laporan Grup PETA" author="BinaHub" creationDate={new Date(data.issuedAt)}>
  <Page size="A4" style={s.page}><Brand/><View style={s.header}><Text style={s.title}>Peta kecenderungan dalam kelompok</Text><Text style={s.name}>{text(data.programName)}</Text><Text style={s.meta}>Disusun pada {date(data.issuedAt)}</Text></View><Disclaimer/>
   <Text style={s.h}>Cakupan laporan</Text><View style={s.coverage}>{[['Pengisian tercatat',data.counts.total],['Hasil disertakan',data.counts.included],['Tidak disertakan',data.counts.total-data.counts.included]].map(([label,value])=><View key={label} style={s.stat}><Text style={s.value}>{value}</Text><Text style={s.note}>{label}</Text></View>)}</View>
   <Text style={s.body}>Laporan ini hanya mencakup hasil selesai yang masih dalam masa simpan dan diizinkan untuk ditinjau. Tidak mewakili peserta yang belum mengisi atau tidak disertakan.</Text>
   <Text style={s.note}>Belum selesai: {data.counts.unfinished}. Peninjauan tidak diizinkan/tidak tersedia: {data.counts.restricted}. Akses dicabut, kedaluwarsa, atau hasil tidak tersedia: {data.counts.unavailable}.</Text>
   <View style={s.section}><Text style={s.h}>Kecenderungan yang muncul dalam kelompok</Text><View style={s.tableHead}><Text style={[s.tableLabel,s.bold]}>Dimensi</Text><Text style={[s.tableNumber,s.bold]}>Jumlah peserta</Text></View>{Object.entries(petaDimensions).map(([d,value])=><View key={d} style={s.tableRow}><Text style={s.tableLabel}>{d} - {value.title}</Text><Text style={s.tableNumber}>{pattern.counts[d as keyof typeof petaDimensions]}</Text></View>)}
    <Text style={[s.note,{marginTop:10}]}>Hitungan menunjukkan dimensi dengan selisih tertinggi dalam diri peserta. Jika dua atau tiga dimensi seri, setiap dimensi dihitung: {pattern.tied} peserta memiliki pola seri. Pola berimbang di keempat dimensi: {pattern.balanced} peserta, dicatat terpisah. Jumlah pada empat baris tidak harus sama dengan jumlah hasil yang disertakan.</Text>
   </View><View style={s.section}><Text style={s.h}>Bahan percakapan kelompok</Text><Text style={s.body}>Cara kerja apa yang sudah saling melengkapi? Di situasi apa perbedaan pendekatan perlu dibicarakan? Kesepakatan kerja apa yang ingin dicoba bersama?</Text><Text style={s.note}>Ini bukan tipe kepribadian kelompok, rata-rata kemampuan, atau peringkat peserta. Baca bersama konteks pekerjaan dan percakapan dengan peserta.</Text></View><Footer internal/>
  </Page>
  <Page size="A4" style={s.page}><View fixed><Brand/><View style={s.header}><Text style={s.compactTitle}>Rincian hasil peserta</Text><Text style={s.meta}>{text(data.programName)}</Text><Text style={s.note}>Urutan alfabetis, bukan peringkat. Setiap sel: paling sesuai / paling kurang sesuai / selisih.</Text></View><View style={s.tableHead}><Text style={[s.participant,s.bold]}>Peserta</Text>{[...'DISC'].map(d=><Text key={d} style={[s.scores,s.bold]}>{d}</Text>)}</View></View>
   {data.members.map((m,i)=><View key={m.report.participantCode+':'+i} style={s.matrixRow} wrap={false} minPresenceAhead={i===data.members.length-1?65:0}><Text style={s.participant}>{text(m.participantName||`Peserta ${i+1}`)}</Text>{[...'DISC'].map(d=>{const r=m.report.result.rows.find(r=>r.dimension===d)!;return <Text key={d} style={s.scores}>{r.most} / {r.least} / {signed(r.net)}</Text>;})}</View>)}
   <Text style={[s.note,{marginTop:18}]}>Rahasia. Memuat hasil pribadi peserta. Izin peninjauan bukan izin penyebaran kepada perusahaan, atasan, atau pihak lain. Jangan bagikan tanpa dasar dan izin yang sesuai.</Text><Footer internal/>
  </Page>
 </Document>;
}
export async function renderPetaIndividualPDF(input:unknown){return renderToBuffer(<PetaIndividualPDF data={PetaIndividualPDFData.parse(input)}/>);}
export async function renderPetaGroupPDF(input:unknown){const data=PetaGroupReport.parse(input);if(!data.members.length)throw new PetaError('PETA_NO_REVIEWABLE_RESULTS');return renderToBuffer(<PetaGroupPDF data={data}/>);}
