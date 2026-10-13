import { NextRequest } from 'next/server';
import { requirePEOwner,readPEBody,peFailure,peJson } from '@/lib/individual-assessment/http';
import { createPEParticipantStore,getPEDeliveryDefinition } from '@/lib/individual-assessment/delivery';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { PE_REVIEW_CONSENT_VERSION } from '@/lib/individual-assessment/delivery-contracts';

export async function GET(req:NextRequest) {
  try {
    const actor=await requirePEOwner(req);if(actor instanceof Response)return actor;
    const {definition}=await getPEDeliveryDefinition(actor.db);
    const acceptingNew=await pePilotRPC(actor.db,'pe_pilot_ready');
    return peJson({success:true,definition:{...definition,features:{pilot:true,history:true},acceptingNew:acceptingNew===true,
      sharingConsentVersion:PE_REVIEW_CONSENT_VERSION,
      sharingNotice:'Dengan persetujuan Anda, profil akun, konteks pekerjaan, jawaban, dan hasil dapat ditinjau tim BinaHub untuk memberi rekomendasi pengembangan. Tidak dibagikan otomatis ke perusahaan. Akses tim dapat Anda cabut kapan saja.',
      privacyNotice:'Jawaban dan hasil disimpan enam bulan. Anda mengendalikan akses tim BinaHub dan dapat menghapus pengisian lebih awal.'}});
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
