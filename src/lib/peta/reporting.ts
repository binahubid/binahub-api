import type {z} from 'zod';
import type {PetaResult, PetaGroupReport} from './contracts';

export const petaDimensions={
 D:{title:'Mendorong penyelesaian',text:'Kecenderungan mengambil keputusan dan menggerakkan pekerjaan menuju hasil.'},
 I:{title:'Membangun pengaruh',text:'Kecenderungan bertukar gagasan dan melibatkan orang lain melalui komunikasi.'},
 S:{title:'Menjaga kerja sama',text:'Kecenderungan menjaga dukungan, kesinambungan, dan kerja sama.'},
 C:{title:'Memeriksa standar',text:'Kecenderungan memperhatikan ketelitian, bukti, dan standar pekerjaan.'},
} as const;
export type PetaDimension=keyof typeof petaDimensions;

/** Same deterministic, tie-preserving language as the participant HTML report. */
export function petaReportNarrative(result:z.infer<typeof PetaResult>):string{
 const tendencies={D:'mengambil keputusan dan menggerakkan pekerjaan menuju hasil',I:'bertukar gagasan dan melibatkan orang lain melalui komunikasi',S:'menjaga dukungan, kesinambungan, dan kerja sama',C:'memperhatikan ketelitian, bukti, dan standar pekerjaan'};
 const highest=Math.max(...result.rows.map(row=>row.net));
 const top=result.rows.filter(row=>row.net===highest).map(row=>tendencies[row.dimension]);
 if(top.length===4)return 'Pilihan Anda menunjukkan kecenderungan yang relatif berimbang antara mendorong penyelesaian, melibatkan orang lain, menjaga kerja sama, dan memperhatikan ketelitian. Tidak ada satu kecenderungan yang paling menonjol berdasarkan selisih pilihan Anda. Cara Anda merespons dapat berbeda sesuai situasi; gunakan hasil ini sebagai bahan refleksi, bukan label diri yang tetap.';
 const list=top.length===1?top[0]:top.length===2?top.join(' dan '):top.slice(0,-1).join(', ')+', dan '+top.at(-1);
 const opening=top.length===1?'Berdasarkan pilihan Anda, kecenderungan untuk '+list+' relatif paling menonjol.':'Berdasarkan pilihan Anda, terlihat perpaduan kecenderungan untuk '+list+', dengan selisih pilihan tertinggi yang sama.';
 const ordered=result.rows.map(row=>row.net).sort((a,b)=>b-a);
 const context=top.length===1&&ordered[0]-ordered[1]<=2?' Selisih dengan kecenderungan berikutnya tipis, sehingga seluruh pola perlu dibaca sebagai satu kesatuan.':' Kecenderungan ini menggambarkan cara yang terasa lebih sesuai bagi Anda dalam situasi yang ditanyakan, bukan kemampuan yang lebih tinggi atau lebih rendah.';
 return opening+context+' Cocokkan gambaran ini dengan pengalaman sehari-hari dan gunakan sebagai bahan refleksi, bukan label pribadi yang tetap.';
}

/** Counts of within-person maxima, NOT normative group scores or ability ranks. */
export function petaGroupPattern(members:z.infer<typeof PetaGroupReport>['members']){
 const counts:Record<PetaDimension,number>={D:0,I:0,S:0,C:0};let balanced=0,tied=0;
 for(const {report:{result}} of members){
  const highest=Math.max(...result.rows.map(r=>r.net)),tops=result.rows.filter(r=>r.net===highest);
  if(tops.length===4){balanced++;continue;}
  if(tops.length>1)tied++;
  for(const r of tops)counts[r.dimension]++;
 }
 return {counts,balanced,tied};
}
