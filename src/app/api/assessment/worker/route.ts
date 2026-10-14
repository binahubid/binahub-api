import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processAssessmentJob } from '@/lib/assessment-worker';
import { createServerSupabase } from '@/lib/supabase';
import { processPEReportEmail } from '@/lib/individual-assessment/email';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  // Reuse the existing trusted scheduler credential; no new daily env toggle.
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
  if (!secret || Buffer.byteLength(token) !== Buffer.byteLength(secret)
    || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // Existing scheduler also enforces PE's six-month retention. Missing SQL 65
    // must not interrupt legacy assessment recovery during a rolling deployment.
    let personalDataPurged: number | null = null;
    try {
      const { data, error } = await createServerSupabase().rpc('pe_purge_expired_participants', { p_limit: 100 });
      if (!error) personalDataPurged = typeof data === 'number' ? data : null;
      else if (!['42883', 'PGRST202'].includes(error.code || '')) console.error('[PE retention] Cleanup unavailable');
    } catch { console.error('[PE retention] Cleanup unavailable'); }
    let personalEmail: { processed: boolean; status?: string } = { processed: false };
    try { personalEmail = await processPEReportEmail(); } catch { console.error('[PE email] PE_WORKER_UNAVAILABLE'); }
    return NextResponse.json({ ...await processAssessmentJob(), personalDataPurged, personalEmail }, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch { return NextResponse.json({ error: 'Assessment worker unavailable' }, { status: 503 }); }
}
