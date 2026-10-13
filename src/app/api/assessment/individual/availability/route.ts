import { NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { PE_POLICY_ID } from '@/lib/individual-assessment/delivery-contracts';
import { peJson } from '@/lib/individual-assessment/http';

// Public readiness only. No source content, hashes, keys, participant or result data.
export async function GET(req:NextRequest) {
  try {
    const limited=await enforceRateLimit(req,'pe-availability',300,3600);if(limited)return limited;
    const {data,error}=await createServerSupabase().from('pe_delivery_policies').select('id,release_status,content_review')
      .eq('id',PE_POLICY_ID).maybeSingle();
    if(error||!data)return peJson({success:true,available:false});
    return peJson({success:true,available:data.release_status==='development_pilot'&&data.content_review==='ceo_reviewed',
      freeAreaCount:3,accountRequired:true});
  }catch{console.error('[Personal Effectiveness] Availability unavailable');return peJson({success:true,available:false});}
}
