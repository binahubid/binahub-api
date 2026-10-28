import { after,NextRequest } from 'next/server';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { createPEParticipantStore } from '@/lib/individual-assessment/delivery';
import { getPEReviewAccess,loadPEReportView } from '@/lib/individual-assessment/pilot';
import { preparePEAccountContact,queuePEGuestReport } from '@/lib/individual-assessment/guest';
import { PEWriteSchema } from '@/lib/individual-assessment/delivery-contracts';
import { processPEReportEmail } from '@/lib/individual-assessment/email';
export const maxDuration=120;

type Context={params:Promise<{id:string}>};
export async function GET(req:NextRequest,context:Context) {
  try {
    const actor=await requirePEOwner(req);if(actor instanceof Response)return actor;
    const {id}=await context.params;
    const attempt=await createPEParticipantStore(actor.db,actor.ownerId).read(id);
    const {report}=await loadPEReportView(actor.db,attempt);
    const access=await getPEReviewAccess(actor.db,attempt.id,actor.ownerId);
    return peJson({success:true,attempt,report,access});
  }catch(error){return peFailure(error);}
}
export async function PATCH(req:NextRequest,context:Context) {
  try {
    const actor=await requirePEOwner(req,true);if(actor instanceof Response)return actor;
    const {id}=await context.params;
    const input=PEWriteSchema.parse(await readPEBody(req));
    const draftKey=input.submissionKey?await preparePEAccountContact(actor.db,id,actor.ownerId):null;
    const attempt=await createPEParticipantStore(actor.db,actor.ownerId).write(id,input);
    if(attempt.status==='submitted'&&draftKey){
      after(async()=>{try{await queuePEGuestReport(actor.db,id,draftKey,attempt);await processPEReportEmail(id);}catch{console.error('[PE email] PE_WORKER_RETRY');}});
    }
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
