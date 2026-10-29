import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export const PETA_ID='PETA-DISC-FC24',PETA_VERSION='1.0.0-pilot';
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>JSON.stringify(sort(value));
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])):value;}
export function publicHash(source){const copy=structuredClone(source);delete copy.contentSha256;return hash(canonical(copy));}
export function keyHash(key){return hash(Object.keys(key).sort().map(id=>id+':'+['A','B','C','D'].map(c=>key[id][c]).join('')).join('|'));}
export function validateSource(pub,priv){
 if(pub?.instrumentId!==PETA_ID||pub.version!==PETA_VERSION||pub.blockCount!==24||pub.blocks?.length!==24||pub.contentSha256!==publicHash(pub))throw Error('PETA_SOURCE_INVALID');
 if(priv?.instrumentId!==pub.instrumentId||priv.version!==pub.version||priv.contentSha256!==pub.contentSha256||Object.keys(priv.optionToDimension||{}).length!==24)throw Error('PETA_SOURCE_INVALID');
 const patterns=new Set(),positions=Object.fromEntries('DISC'.split('').map(d=>[d,{A:0,B:0,C:0,D:0}]));
 pub.blocks.forEach((b,i)=>{
  if(b.id!=='PETA-Q'+String(i+1).padStart(2,'0')||b.order!==i+1||typeof b.context!=='string'||b.options?.length!==4)throw Error('PETA_SOURCE_INVALID');
  if(b.options.map(o=>o.code).join('')!=='ABCD'||b.options.some(o=>o.id!==b.id+'-'+o.code||typeof o.text!=='string'||!o.text.trim()||Object.keys(o).some(k=>!['id','code','text'].includes(k))))throw Error('PETA_SOURCE_INVALID');
  const k=priv.optionToDimension[b.id];if(!k||Object.keys(k).sort().join('')!=='ABCD'||Object.values(k).sort().join('')!=='CDIS')throw Error('PETA_SOURCE_INVALID');
  patterns.add('ABCD'.split('').map(c=>k[c]).join(''));for(const c of 'ABCD')positions[k[c]][c]++;
 });
 if(patterns.size!==24||Object.values(positions).some(p=>Object.values(p).some(n=>n!==6)))throw Error('PETA_SOURCE_INVALID');
 return true;
}
function encryptionKey(secret){if(!/^[a-f0-9]{64}$/.test(secret||''))throw Error('PETA_SETUP_REQUIRED');return Buffer.from(secret,'hex');}
const aad=(pub,fingerprint)=>Buffer.from(pub.instrumentId+'@'+pub.version+':'+pub.contentSha256+':'+fingerprint);
export function sealKey(pub,priv,secret){
 validateSource(pub,priv);const fingerprint=keyHash(priv.optionToDimension),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(secret),iv);cipher.setAAD(aad(pub,fingerprint));
 const ciphertext=Buffer.concat([cipher.update(canonical(priv),'utf8'),cipher.final()]);
 return {keyFingerprint:fingerprint,sealed:{algorithm:'A256GCM',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')}};
}
export function openKey(pub,sealed,fingerprint,secret){
 try{if(sealed.algorithm!=='A256GCM')throw Error();const decipher=createDecipheriv('aes-256-gcm',encryptionKey(secret),Buffer.from(sealed.iv,'base64'));decipher.setAAD(aad(pub,fingerprint));decipher.setAuthTag(Buffer.from(sealed.tag,'base64'));
  const priv=JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext,'base64')),decipher.final()]).toString('utf8'));validateSource(pub,priv);if(keyHash(priv.optionToDimension)!==fingerprint)throw Error();return priv;
 }catch{throw Error('PETA_SOURCE_INVALID');}
}
