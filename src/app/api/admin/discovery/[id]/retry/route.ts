import { after,NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { spinBody,spinFailure,spinJson,spinRPC } from '@/lib/spin/http';
import { processSpinWork } from '@/lib/spin/worker';
export const maxDuration=120;
export async function POST(req:NextRequest,ctx:{params:Promise<{id:string}>}){try{
 const actor=await requireAdmin(req);if('error'in actor)return spinJson({success:false,error:'Akses admin diperlukan.'},actor.status);
 const id=z.uuid().parse((await ctx.params).id);z.object({action:z.literal('process_pending')}).strict().parse(await spinBody(req));
 const limited=await enforceRateLimit(req,'spin-admin-process',10,3600);if(limited)return limited;
 // Explicit admin recovery can requeue failed analysis, but never resets email
 // jobs, bypasses an active lease, overwrites a report or duplicates delivery.
 await spinRPC('spin_retry_processing',{p_id:id,p_actor:actor.userId});
 after(async()=>{try{await processSpinWork(id);}catch{console.error('[SPIN] ADMIN_RECOVERY_REQUIRED');}});
 return spinJson({success:true,message:'Pemrosesan antrean dijadwalkan. Status terkirim diperbarui setelah konfirmasi pengiriman.'},202);
}catch(e){return spinFailure(e);}}
