import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { peFailure,peJson,readPEBody } from '@/lib/individual-assessment/http';
import { getPEDeliveryDefinition } from '@/lib/individual-assessment/delivery';
import { PECaseListSchema,PEPilotDashboardSchema,PEPilotStateSchema,loadPEAdminCase,pePilotRPC } from '@/lib/individual-assessment/pilot';

async function guard(req:NextRequest) {
  const admin=await requireAdmin(req);
  if('error' in admin)return peJson({success:false,error:'Akses admin diperlukan.'},admin.status);
  const limited=await enforceRateLimit(req,`pe-admin-${admin.userId}`,120,3600);if(limited)return limited;
  return {db:createServerSupabase(),actorId:admin.userId};
}
export async function GET(req:NextRequest) {
  try {
    const actor=await guard(req);if(actor instanceof Response)return actor;
    const id=req.nextUrl.searchParams.get('id');
    if(id)return peJson({success:true,detail:await loadPEAdminCase(actor.db,z.uuid().parse(id))});
    const before=req.nextUrl.searchParams.get('before'),beforeId=req.nextUrl.searchParams.get('beforeId');
    if(Boolean(before)!==Boolean(beforeId))throw new Error('PE_INVALID_REQUEST');
    const cursor=before?{p_before:z.iso.datetime({offset:true}).parse(before),p_before_id:z.uuid().parse(beforeId)}:{};
    const [dashboard,cases]=await Promise.all([
      pePilotRPC(actor.db,'pe_pilot_dashboard'),pePilotRPC(actor.db,'pe_admin_review_cases',cursor)]);
    return peJson({success:true,dashboard:PEPilotDashboardSchema.parse(dashboard),cases:PECaseListSchema.parse(cases)});
  }catch(error){return peFailure(error);}
}
export async function PATCH(req:NextRequest) {
  try {
    const actor=await guard(req);if(actor instanceof Response)return actor;
    const input=PEPilotStateSchema.parse(await readPEBody(req));
    // Recheck the immutable source hash and CEO-approved policy before any operational change.
    await getPEDeliveryDefinition(actor.db);
    const dashboard=PEPilotDashboardSchema.parse(await pePilotRPC(actor.db,'pe_set_pilot_state',{
      p_status:input.status,p_revision:input.revision,p_actor:actor.actorId}));
    return peJson({success:true,dashboard});
  }catch(error){return peFailure(error);}
}
