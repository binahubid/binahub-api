import { NextRequest } from 'next/server';
import { z } from 'zod';
import { enforceRateLimit } from '@/lib/rate-limit';
import { SPIN_DEFINITION, SpinKey, spinHash, SpinError,spinChallenge } from '@/lib/spin/intake';
import { SPIN_NOTICE_VERSION, SPIN_PRIVACY_NOTICE } from '@/lib/spin/form';
import { spinAvailability } from '@/lib/spin/worker';
import { spinBody,spinDraft,spinFailure,spinJson,spinRPC } from '@/lib/spin/http';
export async function GET(){try{return spinJson({success:true,available:await spinAvailability(),definition:SPIN_DEFINITION,noticeVersion:SPIN_NOTICE_VERSION,privacyNotice:SPIN_PRIVACY_NOTICE});}catch(e){return spinFailure(e);}}
export async function POST(req:NextRequest){try{
 const raw=await spinBody(req),limited=await enforceRateLimit(req,'spin-start',8,3600);if(limited)return limited;
 const input=z.object({id:z.uuid(),key:SpinKey,processingConsent:z.literal(true),noticeVersion:z.literal(SPIN_NOTICE_VERSION),website:z.literal('')}).strict().parse(raw);
 if(!await spinAvailability())throw new SpinError('SPIN_SETUP_REQUIRED');
 const attempt=await spinRPC('spin_start',{p_id:input.id,p_hash:spinHash(input.key),p_version:SPIN_DEFINITION.version,p_notice:input.noticeVersion});
 return spinJson({success:true,attempt:spinDraft(attempt),challenge:spinChallenge(input.id).label},201);
}catch(e){return spinFailure(e);}}
