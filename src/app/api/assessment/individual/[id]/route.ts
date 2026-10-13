import { NextRequest } from 'next/server';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { buildPEDevelopmentReport,createPEParticipantStore,loadPEPersonalSolutions } from '@/lib/individual-assessment/delivery';
import { loadPEInstrument } from '@/lib/individual-assessment/definition';

type Context={params:Promise<{id:string}>};
export async function GET(req:NextRequest,context:Context) {
  try {
    const actor=await requirePEOwner(req);if(actor instanceof Response)return actor;
    const {id}=await context.params;
    const attempt=await createPEParticipantStore(actor.db,actor.ownerId).read(id);
    const instrument=await loadPEInstrument(actor.db);
    const report=attempt.status==='submitted'?buildPEDevelopmentReport(attempt,instrument):null;
    const solutions=report?await loadPEPersonalSolutions(actor.db,report.priorities.map(p=>p.code)):null;
    return peJson({success:true,attempt,report:report?{...report,solutions}:null});
  }catch(error){return peFailure(error);}
}
export async function PATCH(req:NextRequest,context:Context) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    const {id}=await context.params;
    const attempt=await createPEParticipantStore(actor.db,actor.ownerId).write(id,await readPEBody(req));
    return peJson({success:true,attempt});
  }catch(error){return peFailure(error);}
}
export async function DELETE(req:NextRequest,context:Context) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    const {id}=await context.params;
    await createPEParticipantStore(actor.db,actor.ownerId).erase(id);
    return peJson({success:true});
  }catch(error){return peFailure(error);}
}
