import { NextRequest } from 'next/server';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { createPEParticipantStore,getPEDeliveryDefinition } from '@/lib/individual-assessment/delivery';

export async function GET(req:NextRequest) {
  try {
    const actor=await requirePEOwner(req);if(actor instanceof Response)return actor;
    const {definition}=await getPEDeliveryDefinition(actor.db);
    return peJson({success:true,definition});
  }catch(error){return peFailure(error);}
}
export async function POST(req:NextRequest) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    await getPEDeliveryDefinition(actor.db); // Verify source hash and pinned approved delivery policy.
    const attempt=await createPEParticipantStore(actor.db,actor.ownerId).start(await readPEBody(req));
    return peJson({success:true,attempt},201);
  }catch(error){return peFailure(error);}
}
