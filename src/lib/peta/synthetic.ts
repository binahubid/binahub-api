// Synthetic fixtures only. No CEO statements or real option mappings.
import {createHash} from 'node:crypto';
import {publicHash} from '../../../scripts/lib/peta-source.mjs';
export function syntheticPeta(){
 const permute=(text:string):string[]=>text.length===1?[text]:[...text].flatMap((c,i)=>permute(text.slice(0,i)+text.slice(i+1)).map(rest=>c+rest));
 const patterns=permute('DISC');const blocks=patterns.map((_,i)=>{const id='PETA-Q'+String(i+1).padStart(2,'0');return {id,order:i+1,context:'Situasi sintetis '+(i+1),options:[...'ABCD'].map(code=>({id:id+'-'+code,code,text:'Pernyataan sintetis '+code}))};});
 const pub={instrumentId:'PETA-DISC-FC24',version:'1.0.0-pilot',blockCount:24,blocks,contentSha256:''};pub.contentSha256=publicHash(pub);
 const priv={instrumentId:pub.instrumentId,version:pub.version,contentSha256:pub.contentSha256,optionToDimension:Object.fromEntries(blocks.map((b,i)=>[b.id,Object.fromEntries([...'ABCD'].map((c,j)=>[c,patterns[i][j]]))]))};
 return {pub,priv};
}
export const syntheticHash=(v:string)=>createHash('sha256').update(v).digest('hex');
