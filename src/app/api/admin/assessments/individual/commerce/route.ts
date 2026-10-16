import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { peFailure,peJson,readPEBody } from '@/lib/individual-assessment/http';
import { loadPECommerceDashboard,PECommerceSave,PECommerceStatus,peCommerceRPC } from '@/lib/individual-assessment/commerce';
import { z } from 'zod';

async function guard(req:NextRequest) {
  const actor=await requireAdmin(req);
  if('error' in actor)return peJson({success:false,error:'Akses admin diperlukan.'},actor.status);
  const limited=await enforceRateLimit(req,`pe-commerce-admin-${actor.userId}`,120,3600);
  if(limited)return limited;
  return {actorId:actor.userId,db:createServerSupabase()};
}
export async function GET(req:NextRequest) {
  try {
    const actor=await guard(req);if(actor instanceof Response)return actor;
    const query=z.string().trim().max(100).parse(req.nextUrl.searchParams.get('q')||'');
    const status=PECommerceStatus.parse(req.nextUrl.searchParams.get('status')||'all');
    return peJson({success:true,dashboard:await loadPECommerceDashboard(actor.db,query,status)});
  }catch(error){return peFailure(error);}
}
export async function PUT(req:NextRequest) {
  try {
    const actor=await guard(req);if(actor instanceof Response)return actor;
    const input=PECommerceSave.parse(await readPEBody(req));
    await peCommerceRPC(actor.db,'pe_commerce_save_draft',{p_revision:input.revision,p_configuration:input.configuration,p_actor:actor.actorId});
    return peJson({success:true,dashboard:await loadPECommerceDashboard(actor.db)});
  }catch(error){return peFailure(error);}
}
