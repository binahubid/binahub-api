import {createHash,timingSafeEqual} from 'node:crypto';
import {NextRequest} from 'next/server';
import {json,rpc,failure} from '@/lib/peta/http';
export const dynamic='force-dynamic';
export const maxDuration=60;
const BATCH_SIZE=100,MAX_BATCHES=10,SOFT_BUDGET_MS=20000;
const digest=(value:string)=>createHash('sha256').update(value).digest();
async function run(req:NextRequest){
 const secret=process.env.CRON_SECRET,actual=req.headers.get('authorization')||'';
 // Compare fixed-size bytes: malformed Unicode headers cannot throw a length error.
 if(!secret||secret.length<32||actual.length>1024||!timingSafeEqual(digest(actual),digest('Bearer '+secret)))return json({success:false,error:'Tidak diizinkan.'},401);
 const started=Date.now();let erased=0,batches=0,mayHaveMore=false;
 try{
  for(;batches<MAX_BATCHES;){
   const count:unknown=await rpc('peta_purge_expired',{p_limit:BATCH_SIZE});
   if(typeof count!=='number'||!Number.isInteger(count)||count<0||count>BATCH_SIZE)throw Error('Invalid purge count');
   batches++;erased+=count;mayHaveMore=count===BATCH_SIZE;
   if(!mayHaveMore||Date.now()-started>=SOFT_BUDGET_MS)break;
  }
  const summary={erased,batches,mayHaveMore,elapsedMs:Date.now()-started};
  // Counts only: no participant IDs, credentials, source keys or answer content.
  console.info('[PETA retention] completed',summary);
  if(mayHaveMore)console.warn('[PETA retention] batch/time budget reached; run again to drain backlog');
  return json({success:true,...summary});
 }catch(error){
  console.error('[PETA retention] failed',{erased,batches});
  // Completed batches are committed; a subsequent invocation safely resumes.
  const response=failure(error);const payload=await response.json();
  return json({...payload,erased,batches},response.status);
 }
}
export const GET=run; // Vercel Cron sends GET with Authorization: Bearer CRON_SECRET.
export const POST=run; // Authenticated operator retry; never accepts secrets in query strings.
export function HEAD(){const res=json({success:false,error:'Gunakan GET atau POST terautentikasi.'},405);res.headers.set('Allow','GET, POST');return res;}
