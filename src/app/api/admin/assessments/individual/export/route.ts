import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { peFailure,peJson } from '@/lib/individual-assessment/http';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { buildPEEvaluationExport } from '@/lib/individual-assessment/evaluation';
export async function GET(req:NextRequest) {
  try{
    const actor=await requireAdmin(req);if('error' in actor)return peJson({success:false,error:'Akses admin diperlukan.'},actor.status);
    const limited=await enforceRateLimit(req,`pe-evaluation-export-${actor.userId}`,5,3600);if(limited)return limited;
    const rows=await pePilotRPC(createServerSupabase(),'pe_export_evaluation',{p_actor:actor.userId});
    return peJson({success:true,evaluation:buildPEEvaluationExport(rows)});
  }catch(error){return peFailure(error);}
}
