import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { PEReviewUpdateSchema,updatePEReviewAccess } from '@/lib/individual-assessment/pilot';
export async function PATCH(req:NextRequest,context:{params:Promise<{id:string}>}) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    const id=z.uuid().parse((await context.params).id),input=PEReviewUpdateSchema.parse(await readPEBody(req));
    const access=await updatePEReviewAccess(actor.db,id,actor.ownerId,input);
    return peJson({success:true,access});
  }catch(error){return peFailure(error);}
}
