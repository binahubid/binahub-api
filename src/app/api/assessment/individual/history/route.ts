import { NextRequest } from 'next/server';
import { requirePEOwner,peFailure,peJson } from '@/lib/individual-assessment/http';
import { PEHistorySchema,pePilotRPC } from '@/lib/individual-assessment/pilot';
export async function GET(req:NextRequest) {
  try {
    const actor=await requirePEOwner(req);if(actor instanceof Response)return actor;
    const history=PEHistorySchema.parse(await pePilotRPC(actor.db,'pe_owner_history',{p_owner:actor.ownerId}));
    return peJson({success:true,history});
  }catch(error){return peFailure(error);}
}
