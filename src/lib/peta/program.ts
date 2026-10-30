import 'server-only';
import {NextRequest} from 'next/server';
import {z} from 'zod';
import {requireTransformationActor} from '@/lib/transformation/auth';
import {PetaError} from './contracts';
import {credential,rpc} from './http';

export async function programActor(req:NextRequest) {
 const actor=await requireTransformationActor(req);
 if('error' in actor||actor.role!=='client'||!actor.userId||!actor.programId||!actor.participantId||!actor.accessCodeId)throw new PetaError('PETA_SESSION_REQUIRED');
 return {p_actor:actor.userId,p_program:actor.programId,p_participant:actor.participantId,p_access:actor.accessCodeId};
}
export async function scopedCredential(req:NextRequest,write=false) {
 const cap=credential(req,write);
 const scope=z.object({programId:z.uuid().nullable(),participantId:z.uuid().nullable(),accessId:z.uuid().nullable()}).parse(await rpc('peta_credential_scope',{p_hash:cap.hash}));
 if(scope.programId!==null) {
  const actor=await programActor(req);
  if(actor.p_program!==scope.programId||actor.p_participant!==scope.participantId||actor.p_access!==scope.accessId)throw new PetaError('PETA_SESSION_REQUIRED');
 }
 return cap;
}
