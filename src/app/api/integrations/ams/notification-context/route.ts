import { NextRequest, NextResponse } from 'next/server';
import { verifyAmsSignature } from '@/lib/ams-integration';
import { consultantNotificationContext, consultantNotificationCurrent } from '@/lib/consultant/notifications';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (body.length > 4000) return NextResponse.json({ success: false }, { status: 413, headers });
  const signature = verifyAmsSignature(body, request.headers.get('x-binahub-timestamp'), request.headers.get('x-binahub-signature'));
  if (!signature.ok) return NextResponse.json({ success: false }, { status: signature.status, headers });
  try {
    const input = consultantNotificationContext.safeParse(JSON.parse(body));
    if (!input.success) return NextResponse.json({ success: false }, { status: 400, headers });
    return NextResponse.json({ success: true, current: await consultantNotificationCurrent(input.data) }, { headers });
  } catch { return NextResponse.json({ success: false, error: 'Pekerjaan belum dapat diperiksa.' }, { status: 503, headers }); }
}
