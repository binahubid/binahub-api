import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {hash,validateSource,sealKey} from './lib/peta-source.mjs';
// Offline preparation only. No DB, network, project credentials or environment file reads.
const source=process.argv[2];if(!source)throw Error('Usage: node scripts/prepare-peta.mjs <PETA pack directory>');
const root=resolve(source),out=resolve('private/peta-v1');mkdirSync(out,{recursive:true});
const target=join(out,'SQL76B_PETA_SOURCE.private.sql'),env=join(out,'PETA_RUNTIME.private.env');
if(existsSync(target)||existsSync(env))throw Error('Existing private output preserved; use a new empty output location or retain the original key.');
for(const line of readFileSync(join(root,'SHA256SUMS.txt'),'utf8').split(/\r?\n/)){
 const m=line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);if(!m)continue;const path=resolve(root,m[2]);if(!path.startsWith(root+String.fromCharCode(92))&&!path.startsWith(root+'/'))throw Error('Invalid manifest path');if(hash(readFileSync(path))!==m[1].toLowerCase())throw Error('Source checksum mismatch');
}
const pub=JSON.parse(readFileSync(join(root,'instrument/peta-v1.public.json'),'utf8')),priv=JSON.parse(readFileSync(join(root,'instrument/peta-v1.server-private.json'),'utf8'));validateSource(pub,priv);
const secret=process.env.PETA_ENCRYPTION_KEY||randomBytes(32).toString('hex'),sealed=sealKey(pub,priv,secret),quote=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
const sql='-- PETA encrypted source. Apply SQL76 first. No plaintext mapping or encryption key.\nbegin;\nselect public.peta_install_source('+quote(pub)+','+quote(sealed.sealed)+",'"+sealed.keyFingerprint+"','"+pub.contentSha256+"');\ncommit;\n";
writeFileSync(env,'PETA_ENCRYPTION_KEY='+secret+'\n',{flag:'wx',mode:0o600});writeFileSync(target,sql,{flag:'wx',mode:0o600});
console.log('Prepared encrypted SQL76B and separate runtime key in private/peta-v1. Neither is uploaded. Add the runtime key to API hosting privately; never paste it in chat.');
