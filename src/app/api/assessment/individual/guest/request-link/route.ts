import { after,NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCorsHeaders } from '@/lib/cors';
import { peFailure,peJson,readPEBody } from '@/lib/individual-assessment/http';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { hashPEKey,peEmailLinkToken,peGuestDeliveryConfigured } from '@/lib/individual-assessment/guest';
import { processPEReportEmail } from '@/lib/individual-assessment/email';
export const maxDuration=120;
export async function POST(req:NextRequest){
  try{
    const origin=req.headers.get('origin');if(origin&&!getCorsHeaders(origin)['Access-Control-Allow-Origin'])throw new Error('PE_INVALID_REQUEST');
    const limited=await enforceRateLimit(req,'pe-result-link-reissue',3,3600);if(limited)return limited;
    if(!peGuestDeliveryConfigured())throw new Error('PE_GUEST_SETUP_REQUIRED');
    const {email}=z.object({email:z.email().max(254)}).strict().parse(await readPEBody(req));
    const linkId=randomUUID(),attemptId=await pePilotRPC(createServerSupabase(),'pe_request_latest_result_link',{
      p_email:email.trim().toLowerCase(),p_link_id:linkId,p_hash:hashPEKey(peEmailLinkToken(linkId))});
    if(attemptId)after(async()=>{try{await processPEReportEmail(z.uuid().parse(attemptId));}catch{console.error('[PE email] PE_WORKER_RETRY');}});
    // Never disclose whether the address exists, the attempt ID, or the report.
    return peJson({success:true,message:'Jika data cocok, tautan hasil akan dikirim ke email Anda.'},202);
  }catch(error){return peFailure(error);}
}
