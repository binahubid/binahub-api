import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
// Offline generation only; never reads hosting/project credentials or prints the value.
const directory=resolve('private/peta-v1');
mkdirSync(directory,{recursive:true});
const target=join(directory,'CRON_RUNTIME.private.env');
if(existsSync(target))throw Error('Existing private cron secret preserved. No key was rotated.');
writeFileSync(target,'CRON_SECRET='+randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});
console.log('Created private/peta-v1/CRON_RUNTIME.private.env. Copy its value privately to API Production settings; never upload or paste it in chat.');
