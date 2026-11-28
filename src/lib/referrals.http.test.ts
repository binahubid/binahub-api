import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpc, callAms } = vi.hoisted(() => ({ rpc: vi.fn(), callAms: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc }) }));
vi.mock('@/lib/ams-client', () => ({ callAms }));

import { GET, POST } from '@/app/api/referrals/context/route';
import { GET as book } from '@/app/api/referrals/book/route';
import { POST as command } from '@/app/api/integrations/ams/referrals/route';
import { referralAttribution } from '@/lib/referrals';

const a = '7c405c51-c1a0-498b-9a8f-caf5b9e25717';
const b = 'f60cb328-1b56-4b9d-aa3b-77d22d06ea49';
const first = {
  associateId: a, code: 'BH-AABBCCDDEE', visitId: 'd039b580-d8f5-46cb-b8fe-e521aff18d03',
  expiresAt: '2099-02-12T00:00:00.000Z', method: 'link',
};
const second = { ...first, associateId: b, code: 'BH-FFEEDDCCBB' };
const bookingToken = 'd5accd25-c47e-448b-afc0-db39f64727e4';
const commandSecret = 'synthetic-referral-contract-only';
const base = 'https://api.binahub.id/api/referrals';
const cookie = 'bh_referral=' + first.visitId;
const active = new Map<string, boolean>();

function capture(code: string, token?: string, origin = 'https://binahub.id') {
  return POST(new NextRequest(base + '/context', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(token ? { Cookie: token } : {}) },
    body: JSON.stringify({ code, method: 'link' }),
  }));
}
function signed(payload: unknown, secret = commandSecret) {
  const raw = JSON.stringify(payload), timestamp = String(Date.now());
  const signature = createHmac('sha256', secret).update(timestamp + '.' + raw).digest('hex');
  return new NextRequest('https://api.binahub.id/api/integrations/ams/referrals', {
    method: 'POST', headers: { 'X-BinaHub-Timestamp': timestamp, 'X-BinaHub-Signature': signature }, body: raw,
  });
}

beforeEach(() => {
  vi.stubEnv('CALCOM_BOOKING_URL', 'https://cal.com/binahub/konsultasi?utm_source=website');
  vi.stubEnv('NEXT_PUBLIC_CALCOM_BOOKING_URL', '');
  vi.stubEnv('AMS_INTEGRATION_SECRET', commandSecret);
  active.clear();
  active.set(a, true);
  active.set(b, true);
  callAms.mockReset();
  callAms.mockImplementation(async (_, input: { associateId: string }) => ({ success: true, active: active.get(input.associateId) }));
  rpc.mockReset();
  rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    switch (name) {
      case 'consume_api_rate_limit': return { data: true };
      case 'referral_lookup': return { data: args.p_visit === first.visitId || args.p_code === first.code ? first : args.p_code === second.code ? second : null };
      case 'referral_register_visit': return { data: args.p_code === first.code ? first : second };
      case 'referral_issue_booking_token': return { data: bookingToken };
      case 'referral_dashboard': return { data: { total: 0 } };
      case 'referral_code_settings': return { data: { code: first.code, enabled: true } };
      case 'referral_review': return { data: null };
      default: throw Error('Unexpected referral RPC: ' + name);
    }
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Referral API boundaries', () => {
  it('creates a shared HttpOnly cookie and keeps the first valid attribution', async () => {
    const response = await capture(first.code);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Domain=binahub.id');
    expect(response.headers.get('Set-Cookie')).toContain('HttpOnly');
    expect(response.headers.get('Set-Cookie')).toContain('Secure');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    const reply = await response.json();
    expect(reply.context).toEqual({ code: first.code, method: first.method, expiresAt: first.expiresAt });
    const next = await capture(second.code, cookie, 'https://app.binahub.id');
    expect((await next.json()).context.code).toBe(first.code);
    expect(rpc.mock.calls.filter(([name]) => name === 'referral_register_visit')).toHaveLength(1);
    expect(next.headers.has('Set-Cookie')).toBe(false);
  });

  it('rejects an unrelated browser origin and unpublished codes', async () => {
    expect((await capture(first.code, undefined, 'https://example.invalid')).status).toBe(403);
    expect((await capture('not-a-code')).status).toBe(400);
    active.set(a, false);
    expect((await capture(first.code)).status).toBe(404);
    expect(rpc.mock.calls.some(([name]) => name === 'referral_register_visit')).toBe(false);
    const context = await GET(new NextRequest(base + '/context', { headers: { Cookie: cookie } }));
    expect((await context.json()).context).toBeNull();
  });

  it('ignores consent for a different code or an inactive Associate', async () => {
    const request = new NextRequest(base + '/context', { headers: { Cookie: cookie } });
    expect(await referralAttribution(request, first.code)).toEqual({ visitId: first.visitId, share: true });
    expect(await referralAttribution(request, second.code)).toEqual({ visitId: first.visitId, share: false });
    active.set(a, false);
    expect(await referralAttribution(request, first.code)).toEqual({ visitId: null, share: false });
  });

  it('adds opaque Cal.com metadata only for a valid referral and respects the configured host', async () => {
    const request = new NextRequest(base + '/book', { headers: { Cookie: cookie } });
    const response = await book(request);
    expect(response.status).toBe(303);
    const redirect = new URL(response.headers.get('Location')!);
    expect(redirect.origin).toBe('https://cal.com');
    expect(redirect.searchParams.get('metadata[binahub_referral]')).toBe(bookingToken);
    expect(redirect.searchParams.get('utm_source')).toBe('website');
    expect(redirect.toString()).not.toContain(first.visitId);
    active.set(a, false);
    const untagged = await book(request);
    expect(new URL(untagged.headers.get('Location')!).searchParams.has('metadata[binahub_referral]')).toBe(false);
    vi.stubEnv('CALCOM_BOOKING_URL', 'https://elsewhere.invalid/binahub/konsultasi');
    expect((await book(request)).headers.get('Location')).toBe('https://binahub.id/contact');
  });

  it('requires an AMS signature before reading referral records', async () => {
    const payload = { action: 'list', associateId: a, page: 2, source: 'inquiry' };
    expect((await command(signed(payload, 'invalid'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    const response = await command(signed(payload));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('referral_dashboard', expect.objectContaining({ p_associate: a, p_admin: false, p_offset: 20, p_source: 'inquiry' }));
  });

  it('allows an Associate to load a code and reserves changes for confirmed admin commands', async () => {
    const associate = { action: 'settings', associateId: a, email: 'associate@example.invalid' };
    const admin = {
      ...associate, action: 'admin_settings', adminId: b, operation: 'disable',
      expectedCode: first.code, confirmationCode: first.code,
    };
    expect((await command(signed({ ...associate, operation: 'disable', expectedCode: first.code }))).status).toBe(400);
    expect((await command(signed({ ...admin, confirmationCode: second.code }))).status).toBe(400);
    expect((await command(signed(admin, 'invalid'))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect((await command(signed({ ...associate, operation: 'load' }))).status).toBe(200);
    expect((await command(signed(admin))).status).toBe(200);
    expect(rpc).toHaveBeenNthCalledWith(2, 'referral_code_settings', {
      p_associate: a, p_email: associate.email, p_action: 'disable', p_expected_code: first.code,
    });
  });
});
