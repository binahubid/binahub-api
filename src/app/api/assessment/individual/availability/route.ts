import { NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { peJson } from '@/lib/individual-assessment/http';

// Public readiness only. No source content, hashes, keys, participant or result data.
export async function GET(req:NextRequest) {
  try {
    const limited=await enforceRateLimit(req,'pe-availability',300,3600);if(limited)return limited;
    const ready=await pePilotRPC(createServerSupabase(),'pe_pilot_ready');
    return peJson({success:true,available:ready===true,
      freeAreaCount:3,accountRequired:true});
  }catch{console.error('[Personal Effectiveness] Availability unavailable');return peJson({success:true,available:false});}
}
