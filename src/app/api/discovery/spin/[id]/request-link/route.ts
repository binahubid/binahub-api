import { after,NextRequest } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { spinBody,spinFailure,spinJson,spinRPC } from '@/lib/spin/http';
import { processSpinMail } from '@/lib/spin/worker';
export const maxDuration=120;
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){try{
 const id=z.uuid().parse((await ctx.params).id),input=z.object({email:z.email().trim().toLowerCase(),website:z.literal('')}).strict().parse(await spinBody(req));
 const limited=await enforceRateLimit(req,'spin-request-link',5,3600);if(limited)return limited;
 await spinRPC('spin_request_link',{p_id:id,p_email:input.email});
 after(async()=>{try{await processSpinMail(id);}catch{console.error('[SPIN] LINK_RECOVERY_REQUIRED');}});
 return spinJson({success:true,message:'Jika email sesuai dengan pengisian, tautan baru akan dikirim. Periksa kotak masuk dan folder spam.'},202);
}catch(e){return spinFailure(e);}}
