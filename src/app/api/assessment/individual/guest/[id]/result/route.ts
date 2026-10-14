import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCorsHeaders } from '@/lib/cors';
import { peFailure, peJson, readPEBody } from '@/lib/individual-assessment/http';
import { hashPEKey, newPEKey, PE_GUEST_COOKIE, PEGuestKeySchema, readPEGuest } from '@/lib/individual-assessment/guest';
import { createPEParticipantStore } from '@/lib/individual-assessment/delivery';
import { getPEReviewAccess, PEReviewUpdateSchema, pePilotRPC,updatePEReviewAccess } from '@/lib/individual-assessment/pilot';
type Context = { params: Promise<{ id: string }> };
export const maxDuration = 120;

function sessionKey(req: NextRequest, id: string) {
  const value = req.cookies.get(PE_GUEST_COOKIE)?.value || '';
  if (!value.startsWith(id + '.')) throw new Error('PE_ATTEMPT_NOT_FOUND');
  return PEGuestKeySchema.parse(value.slice(id.length + 1));
}
function originAllowed(req: NextRequest) {
  const origin = req.headers.get('origin');
  // The public website may start a diagnosis, but private result cookies belong to the app.
  const appOrigin=origin==='https://app.binahub.id'||origin==='https://app-binahub.vercel.app'
    ||/^http:\/\/(localhost|127\.0\.0\.1):(3000|3001|3002|3100)$/.test(origin||'');
  if (origin && (!appOrigin||!getCorsHeaders(origin)['Access-Control-Allow-Origin'])) throw new Error('PE_INVALID_REQUEST');
}
export async function GET(req: NextRequest, context: Context) {
  try {
    originAllowed(req);
    const limited = await enforceRateLimit(req, 'pe-email-result-read', 120, 3600); if (limited) return limited;
    const { id } = await context.params, db = createServerSupabase();
    const owner = await readPEGuest(db, id, sessionKey(req, id), 'result');
    if(owner.attempt.status!=='submitted'||!owner.report)throw new Error('PE_RESULT_NOT_READY');
    const access = await getPEReviewAccess(db, id, owner.ownerId);
    return peJson({ success: true, report: owner.report, access, retentionUntil: owner.attempt.retentionUntil });
  } catch (error) { return peFailure(error); }
}
export async function POST(req: NextRequest, context: Context) {
  try {
    originAllowed(req);
    const limited = await enforceRateLimit(req, 'pe-email-result-exchange', 15, 3600); if (limited) return limited;
    const { id } = await context.params, db = createServerSupabase();
    const input = z.object({ token: PEGuestKeySchema }).strict().parse(await readPEBody(req));
    const session = newPEKey();
    await pePilotRPC(db, 'pe_exchange_email_link', { p_id: z.uuid().parse(id), p_hash: hashPEKey(input.token), p_session_hash: hashPEKey(session) });
    const response = peJson({ success: true });
    response.cookies.set(PE_GUEST_COOKIE, `${id}.${session}`, { httpOnly: true,
      secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 30 * 60,
      path: '/api/assessment/individual/guest' });
    return response;
  } catch (error) { return peFailure(error); }
}
export async function PATCH(req: NextRequest, context: Context) {
  try {
    originAllowed(req);
    const limited = await enforceRateLimit(req, 'pe-email-result-access', 30, 3600); if (limited) return limited;
    const { id } = await context.params, db = createServerSupabase();
    const owner = await readPEGuest(db, id, sessionKey(req, id), 'result');
    const input = PEReviewUpdateSchema.parse(await readPEBody(req));
    const access = await updatePEReviewAccess(db,id,owner.ownerId,input);
    return peJson({ success: true, access });
  } catch (error) { return peFailure(error); }
}
export async function DELETE(req: NextRequest, context: Context) {
  try {
    originAllowed(req);
    const limited = await enforceRateLimit(req, 'pe-email-result-erase', 10, 3600); if (limited) return limited;
    const { id } = await context.params, db = createServerSupabase();
    const owner = await readPEGuest(db, id, sessionKey(req, id), 'result');
    await createPEParticipantStore(db, owner.ownerId).erase(id);
    const response = peJson({ success: true });
    response.cookies.set(PE_GUEST_COOKIE, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/api/assessment/individual/guest' });
    return response;
  } catch (error) { return peFailure(error); }
}
