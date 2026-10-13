import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { PEReviewUpdateSchema,PEReviewAccessSchema,pePilotRPC } from '@/lib/individual-assessment/pilot';
export async function PATCH(req:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    const id=z.uuid().parse((await context.params).id),input=PEReviewUpdateSchema.parse(await readPEBody(req));
    const access=PEReviewAccessSchema.parse(await pePilotRPC(actor.db,'pe_update_review_access',{p_id:id,p_owner:actor.ownerId,
      p_share:input.share,p_consent_version:input.consentVersion,p_evaluate:input.evaluate,p_clarity:input.clarity,p_usefulness:input.usefulness}));
    return peJson({success:true,access});
  }catch(error){return peFailure(error);}
}
