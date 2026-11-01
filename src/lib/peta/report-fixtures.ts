// Synthetic PDF/test evidence only. No real participants, statements or scoring key.
import {PetaIndividualPDFData,PetaGroupReport} from './contracts';
const report={participantCode:'SYNTHETIC-A',submittedAt:'2026-11-01T03:00:00Z',retentionUntil:'2027-11-01T03:00:00Z',result:{instrumentVersion:'1.0.0-pilot',method:'forced_choice_most_least_net_v1',rows:[{dimension:'D',most:10,least:0,net:10},{dimension:'I',most:7,least:7,net:0},{dimension:'S',most:4,least:9,net:-5},{dimension:'C',most:3,least:8,net:-5}],topDimensions:['D'],topIsTied:false,closeTopScores:false}};
export const petaPDFIndividualFixture=PetaIndividualPDFData.parse({report,participantName:'Ayu Sintetis',programName:'CONTOH - Data sintetis, bukan hasil peserta',issuedAt:'2026-11-01T04:00:00Z'});
const member=(name:string,code:string,most:number[],least:number[])=>({participantName:name,report:{...report,participantCode:code,result:{...report.result,rows:[...'DISC'].map((dimension,i)=>({dimension,most:most[i],least:least[i],net:most[i]-least[i]}))}}});
export const petaPDFGroupFixture=PetaGroupReport.parse({workspaceId:'a3115319-1922-471e-bce7-8239ac25e0c0',programName:petaPDFIndividualFixture.programName,audience:'internal_admin',issuedAt:petaPDFIndividualFixture.issuedAt,counts:{total:7,included:4,unfinished:1,restricted:1,unavailable:1},members:[
 {participantName:'Ayu Sintetis',report:petaPDFIndividualFixture.report},
 member('Budi Sintetis','SYNTHETIC-B',[9,9,3,3],[3,3,9,9]),
 member('Citra Sintetis','SYNTHETIC-C',[6,6,6,6],[6,6,6,6]),
 member('Dian Sintetis','SYNTHETIC-D',[0,24,0,0],[24,0,0,0]),
]});
