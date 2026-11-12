import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { processAssessmentJob } from '@/lib/assessment-worker';
import { createServerSupabase } from '@/lib/supabase';
import { processPEReportEmail } from '@/lib/individual-assessment/email';
import { processSpinWork } from '@/lib/spin/worker';
import { reportWorkerHeartbeat } from '@/lib/service-health';
import { processConsultantMessage } from '@/lib/consultant/messages';
import { processConsultantNotifications } from '@/lib/consultant/notifications';

export const runtime = 'nodejs';
export const maxDuration = 120;
export async function GET(request: NextRequest) {
  // Reuse the existing trusted scheduler credential; no new daily env toggle.
  const secret = process.env.FOLLOW_UP_CRON_SECRET;
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!secret || Buffer.byteLength(token) !== Buffer.byteLength(secret)
    || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  const runToken = randomUUID();
  let heartbeatDb: ReturnType<typeof createServerSupabase> | null = null;
  let degraded = false;
  try {
    heartbeatDb = createServerSupabase();
    await reportWorkerHeartbeat(heartbeatDb, runToken);
    // Existing scheduler also enforces the current PE retention policy. Missing SQL 65
    // must not interrupt legacy assessment recovery during a rolling deployment.
    let personalDataPurged: number | null = null;
    try {
      const { data, error } = await createServerSupabase().rpc('pe_purge_expired_participants', { p_limit: 100 });
      if (!error) personalDataPurged = typeof data === 'number' ? data : null;
      else if (!['42883', 'PGRST202'].includes(error.code || '')) { degraded = true; console.error('[PE retention] Cleanup unavailable'); }
    } catch { degraded = true; console.error('[PE retention] Cleanup unavailable'); }
    let personalEmail: { processed: boolean; status?: string } = { processed: false };
    try { personalEmail = await processPEReportEmail(); } catch { degraded = true; console.error('[PE email] PE_WORKER_UNAVAILABLE'); }
    let discovery: { processed: boolean; status?: string } = { processed: false };
    try { discovery = await processSpinWork(); } catch { degraded = true; console.error('[SPIN] WORKER_UNAVAILABLE'); }
    let consultant: { processed: boolean; status?: string } = { processed: false };
    try { consultant = await processConsultantMessage(); } catch { degraded = true; console.error('[Consultant] WORKER_UNAVAILABLE'); }
    const [assessment, consultantNotifications] = await Promise.all([
      processAssessmentJob(),
      processConsultantNotifications().catch(() => {
        console.error('[Consultant notifications] WORKER_UNAVAILABLE');
        return { state: 'degraded', accepted: 0 };
      }),
    ]);
    if (consultantNotifications.state === 'degraded') degraded = true;
    const held = [personalEmail.status, discovery.status, assessment.status, consultant.status].some(status => ['failed','uncertain','pending','setup_required'].includes(status || ''));
    await reportWorkerHeartbeat(heartbeatDb, runToken, degraded || held ? 'degraded' : 'ok');
    return NextResponse.json({ ...assessment, personalDataPurged, personalEmail, discovery, consultant, consultantNotifications }, { headers: { 'Cache-Control': 'no-store' } });
  }
  catch {
    if (heartbeatDb) await reportWorkerHeartbeat(heartbeatDb, runToken, 'error');
    return NextResponse.json({ error: 'Assessment worker unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}

// Next may otherwise implement HEAD by executing GET. A liveness probe must not
// claim jobs, purge expired PE data, invoke providers or send result emails.
export function HEAD() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'GET', 'Cache-Control': 'no-store' } });
}
