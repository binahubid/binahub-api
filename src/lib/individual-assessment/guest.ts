import 'server-only';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PEStartSchema, PEDeliveryAttemptSchema } from './delivery-contracts';
import { PEDeliveryError,loadPEPersonalSolutions } from './delivery';
import { pePilotRPC } from './pilot';
import { buildPEReport } from './report';
import { loadPEInstrument } from './definition';

export const PE_GUEST_COOKIE = 'pe_result_session';
export const PEGuestKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
export const PEGuestStartSchema = PEStartSchema.extend({
  name: z.string().trim().min(1).max(100), email: z.email().trim().toLowerCase().max(254), draftKey: PEGuestKeySchema,
  attribution: z.object(Object.fromEntries(['utmSource','utmMedium','utmCampaign','utmContent','utmTerm','gclid','fbclid','msclkid'].map(key=>[key,z.string().trim().max(500).optional()]))).strict()
    .transform(values=>Object.fromEntries(Object.entries(values).filter(([,value])=>value&&!/@|[\r\n]|https?:\/\/|bearer\s|(?:access_token|api_key|secret)=/i.test(value)))).default({}),
  journeyId:z.uuid().optional(),
}).strict();
export const hashPEKey = (token: string) => createHash('sha256').update(token).digest('hex');
export const newPEKey = () => randomBytes(32).toString('hex');
function peScopedKey(scope:string,id:string) {
  const secret = process.env.PROPOSAL_LINK_SECRET;
  if (!secret || secret.length < 32) throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
  return createHmac('sha256', secret).update(`binainsights/${scope}/${z.uuid().parse(id)}`).digest('hex');
}
export const peEmailLinkToken=(id:string)=>peScopedKey('result-link/v1',id);
export function peGuestDeliveryConfigured() {
  return Boolean(process.env.PROPOSAL_LINK_SECRET && process.env.PROPOSAL_LINK_SECRET.length >= 32
    && process.env.RESEND_API_KEY && process.env.EMAIL_FROM?.includes('@') && !process.env.EMAIL_FROM.includes('resend.dev'));
}
export const PEGuestEnvelopeSchema = z.object({ attempt: PEDeliveryAttemptSchema, ownerId: z.uuid(),
  name: z.string(), email: z.email(), report: z.record(z.string(), z.unknown()).nullable(), emailStatus: z.string().nullable() });
export async function readPEGuest(db: SupabaseClient, id: string, key: string, scope = 'draft') {
  return PEGuestEnvelopeSchema.parse(await pePilotRPC(db, 'pe_guest_attempt', {
    p_id: z.uuid().parse(id), p_hash: hashPEKey(PEGuestKeySchema.parse(key)), p_scope: scope,
  }));
}
export function peGuestDTO(envelope: z.infer<typeof PEGuestEnvelopeSchema>) {
  // A draft capability cannot read a report. Never return pseudo-owner IDs or contact data.
  return { attempt: { ...envelope.attempt, result: null }, emailStatus: envelope.emailStatus };
}
export async function queuePEGuestReport(db: SupabaseClient, id: string, draftKey: string, attempt: z.infer<typeof PEDeliveryAttemptSchema>) {
  return queuePEReportHash(db,id,hashPEKey(draftKey),attempt);
}
export async function queuePEReportHash(db: SupabaseClient,id:string,draftHash:string,attempt:z.infer<typeof PEDeliveryAttemptSchema>) {
  const instrument=await loadPEInstrument(db, attempt.result!.instrumentVersion);
  const base=buildPEReport(attempt,instrument);
  const snapshot = buildPEReport(attempt,instrument,await loadPEPersonalSolutions(db,base.priorities.map(p=>p.code)));
  const linkId = randomUUID();
  await pePilotRPC(db, 'pe_queue_guest_report', { p_id: id, p_hash: draftHash,
    p_snapshot: snapshot, p_link_id: linkId, p_link_hash: hashPEKey(peEmailLinkToken(linkId)) });
}
export async function preparePEAccountContact(db:SupabaseClient,id:string,owner:string) {
  const {data,error}=await db.auth.admin.getUserById(owner);
  if(error||!data.user?.email_confirmed_at||!data.user.email)throw new PEDeliveryError('PE_SERVICE_UNAVAILABLE');
  const draftKey=peScopedKey('account-draft/v1',id);
  await pePilotRPC(db,'pe_attach_account_contact',{p_id:z.uuid().parse(id),p_owner:owner,
    p_name:typeof data.user.user_metadata?.full_name==='string'?data.user.user_metadata.full_name.trim().slice(0,100)||'Peserta':'Peserta',
    p_email:data.user.email.trim().toLowerCase(),p_hash:hashPEKey(draftKey)});
  return draftKey;
}
