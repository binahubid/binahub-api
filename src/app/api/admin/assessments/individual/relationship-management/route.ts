import {NextRequest} from 'next/server';
import {requireAdmin} from '@/lib/admin-auth';
import {createServerSupabase} from '@/lib/supabase';
import {enforceRateLimit} from '@/lib/rate-limit';
import {peJson,readPEBody} from '@/lib/individual-assessment/http';
import {loadRMInstrument,rmParticipantDefinition,rmReadiness} from '@/lib/relationship-management/instrument';
import {previewRMReport} from '@/lib/relationship-management/scoring';
import {z} from 'zod';
async function guard(req:NextRequest){
 const actor=await requireAdmin(req);
 if('error' in actor)return peJson({success:false,error:'Akses admin diperlukan.'},actor.status);
 const limited=await enforceRateLimit(req,`rm-review-${actor.userId}`,60,3600);if(limited)return limited;
 return {db:createServerSupabase()};
}
export async function GET(req:NextRequest){
 const actor=await guard(req);if(actor instanceof Response)return actor;
 try{const source=await loadRMInstrument(actor.db);
  return peJson({success:true,readiness:rmReadiness(source),definition:source?rmParticipantDefinition(source):null});
 }catch{return peJson({success:false,error:'Sumber RM belum dapat dimuat. Periksa instalasi dan integritas sumber.'},503);}
}
export async function POST(req:NextRequest){
 const actor=await guard(req);if(actor instanceof Response)return actor;
 try{const body=z.object({responses:z.unknown()}).strict().parse(await readPEBody(req));
  const source=await loadRMInstrument(actor.db);if(!source)return peJson({success:false,error:'Sumber RM belum dipasang.'},409);
  return peJson({success:true,report:previewRMReport(source,body.responses)});
 }catch{return peJson({success:false,error:'Pratinjau belum dapat dihitung. Periksa jawaban dan sumber RM.'},422);}
}
