import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { processAssessmentJob } from '@/lib/assessment-worker';

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
  try { return NextResponse.json(await processAssessmentJob(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Assessment worker unavailable' }, { status: 503 }); }
}
