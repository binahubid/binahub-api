import { after,NextRequest } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { SpinKey,SpinError,spinChallenge,spinHash,summaryHash,validateSpinWrite } from '@/lib/spin/intake';
import { processSpinWork } from '@/lib/spin/worker';
import { spinBody,spinDraft,spinFailure,spinJson,spinRPC } from '@/lib/spin/http';
export const maxDuration=120;
type Context={params:Promise<{id:string}>};
export async function GET(req:NextRequest,ctx:Context){try{
 const id=z.uuid().parse((await ctx.params).id),key=SpinKey.parse(req.headers.get('authorization')?.replace(/^Bearer /,''));
 const limited=await enforceRateLimit(req,'spin-draft-read',300,3600);if(limited)return limited;
 const attempt=await spinRPC('spin_read_draft',{p_id:id,p_hash:spinHash(key)});
 return spinJson({success:true,attempt:spinDraft(attempt),challenge:spinChallenge(id).label});
}catch(e){return spinFailure(e);}}
export async function PATCH(req:NextRequest,ctx:Context){try{
 const id=z.uuid().parse((await ctx.params).id),input=validateSpinWrite(await spinBody(req));
 if(input.submit&&input.submit.challengeAnswer!==spinChallenge(id).answer)throw new SpinError('SPIN_CHALLENGE_INVALID');
 const limited=await enforceRateLimit(req,'spin-draft-write',300,3600);if(limited)return limited;
 const attempt=await spinRPC('spin_write',{p_id:id,p_hash:spinHash(input.key),p_revision:input.revision,p_answers:input.answers,p_confirmation:input.confirmation,p_summary:input.summary,p_submit:input.submit||null});
 if(input.submit)after(async()=>{try{await processSpinWork(id);}catch{console.error('[SPIN] RECOVERY_REQUIRED');}});
 return spinJson({success:true,attempt:spinDraft(attempt),summaryHash:summaryHash(input.answers)},input.submit?202:200);
}catch(e){return spinFailure(e);}}
