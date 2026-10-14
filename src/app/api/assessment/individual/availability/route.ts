import { NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { peJson,peFailure } from '@/lib/individual-assessment/http';
import { PEDeliveryError } from '@/lib/individual-assessment/delivery';
import { peGuestDeliveryConfigured } from '@/lib/individual-assessment/guest';

// Public readiness only. No source content, hashes, keys, participant or result data.
export async function GET(req:NextRequest) {
  try {
    const limited=await enforceRateLimit(req,'pe-availability',300,3600);if(limited)return limited;
    const db=createServerSupabase();
    const ready=await pePilotRPC(db,'pe_pilot_ready');
    const guest=await db.from('pe_guest_contacts').select('attempt_id').limit(0);
    if(guest.error||!peGuestDeliveryConfigured())throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
    return peJson({success:true,available:ready===true,
      freeAreaCount:3,accountRequired:false});
  }catch(error){return peFailure(error);}
}
