import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { SpinKey,spinHash } from '@/lib/spin/intake';
import { spinBody,spinFailure,spinHeaders,spinJson,spinRPC } from '@/lib/spin/http';
import { spinRandomKey } from '@/lib/spin/worker';
import { readSpinReport } from '@/lib/spin/report';
import { renderSpinPDF } from '@/lib/spin/pdf';
type Context={params:Promise<{id:string}>};
export async function POST(req:NextRequest,ctx:Context){try{
 const id=z.uuid().parse((await ctx.params).id);
 const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('open'),linkId:z.uuid(),key:SpinKey}).strict(),
 z.object({action:z.enum(['read','pdf']),session:SpinKey}).strict()]).parse(await spinBody(req));
 const limited=await enforceRateLimit(req,'spin-result',120,3600);if(limited)return limited;
 if(input.action==='open'){
 const session=spinRandomKey();await spinRPC('spin_open_result',{p_id:id,p_link:input.linkId,p_hash:spinHash(input.key),p_session:spinHash(session)});
 return spinJson({success:true,session,report:readSpinReport(await spinRPC('spin_read_result',{p_id:id,p_session:spinHash(session)}))});
 }
 const report=readSpinReport(await spinRPC('spin_read_result',{p_id:id,p_session:spinHash(input.session)}));
 if(input.action==='pdf')return new NextResponse(new Uint8Array(await renderSpinPDF(report)),{headers:{...spinHeaders,'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="BinaHub-Rekomendasi-Pengembangan.pdf"'}});
 return spinJson({success:true,report});
}catch(e){return spinFailure(e);}}
