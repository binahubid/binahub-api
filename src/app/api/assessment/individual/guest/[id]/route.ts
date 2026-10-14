import { after, NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { peFailure, peJson, readPEBody } from '@/lib/individual-assessment/http';
import { createPEParticipantStore } from '@/lib/individual-assessment/delivery';
import { PEWriteSchema } from '@/lib/individual-assessment/delivery-contracts';
import { PEGuestKeySchema, peGuestDTO, queuePEGuestReport, readPEGuest } from '@/lib/individual-assessment/guest';
import { processPEReportEmail } from '@/lib/individual-assessment/email';
type Context = { params: Promise<{ id: string }> };
export const maxDuration = 120;
const key = (req: NextRequest) => PEGuestKeySchema.parse(req.headers.get('authorization')?.replace(/^PE-Draft /, ''));

export async function GET(req: NextRequest, context: Context) {
  try {
    const limited = await enforceRateLimit(req, 'pe-guest-read', 300, 3600); if (limited) return limited;
    const { id } = await context.params;
    return peJson({ success: true, ...peGuestDTO(await readPEGuest(createServerSupabase(), id, key(req))) });
  } catch (error) { return peFailure(error); }
}
export async function PATCH(req: NextRequest, context: Context) {
  try {
    const limited = await enforceRateLimit(req, 'pe-guest-save', 300, 3600); if (limited) return limited;
    const { id } = await context.params, draftKey = key(req), db = createServerSupabase();
    const owner = await readPEGuest(db, id, draftKey);
    const input = PEWriteSchema.parse(await readPEBody(req));
    const store = createPEParticipantStore(db, owner.ownerId);
    // A lost final HTTP response can be recovered using the same draft capability. Final answers
    // remain immutable; repair only queues the report for an identical submitted snapshot.
    const attempt = owner.attempt.status==='submitted' && input.submissionKey && JSON.stringify(Object.entries(input.responses).sort())===JSON.stringify(Object.entries(owner.attempt.responses).sort())
      ? await store.read(id) : await store.write(id, input);
    if (input.submissionKey) {
      await queuePEGuestReport(db, id, draftKey, attempt);
      after(async () => { try { await processPEReportEmail(id); } catch { console.error('[PE email] PE_WORKER_RETRY'); } });
    }
    return peJson({ success: true, attempt: { ...attempt, result: null }, emailStatus: input.submissionKey ? 'pending' : null }, input.submissionKey ? 202 : 200);
  } catch (error) { return peFailure(error); }
}
