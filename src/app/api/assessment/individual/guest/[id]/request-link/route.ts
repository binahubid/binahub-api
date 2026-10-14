import { after, NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCorsHeaders } from '@/lib/cors';
import { peFailure, peJson, readPEBody } from '@/lib/individual-assessment/http';
import { hashPEKey, peEmailLinkToken } from '@/lib/individual-assessment/guest';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { processPEReportEmail } from '@/lib/individual-assessment/email';
export const maxDuration = 120;
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const origin = req.headers.get('origin');
    if (origin && !getCorsHeaders(origin)['Access-Control-Allow-Origin']) return peJson({ success: false, error: 'Permintaan tidak diizinkan.' }, 403);
    const limited = await enforceRateLimit(req, 'pe-email-result-request', 3, 3600); if (limited) return limited;
    const { id } = await context.params;
    const input = z.object({ email: z.email().toLowerCase().max(254) }).strict().parse(await readPEBody(req));
    const linkId = randomUUID(), db = createServerSupabase();
    const queued = await pePilotRPC(db, 'pe_request_result_link', { p_id: z.uuid().parse(id), p_email: input.email,
      p_link_id: linkId, p_hash: hashPEKey(peEmailLinkToken(linkId)) });
    if (queued) after(async () => { try { await processPEReportEmail(id); } catch { console.error('[PE email] PE_WORKER_RETRY'); } });
    return peJson({ success: true, message: 'Jika data cocok, tautan hasil akan dikirim ke email Anda.' }, 202);
  } catch (error) { return peFailure(error); }
}
