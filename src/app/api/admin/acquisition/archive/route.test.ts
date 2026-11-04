import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
import { GET } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const req = (query = '') => new NextRequest('https://api.example.invalid/api/admin/acquisition/archive' + query);
const empty = { version: 1, kind: 'campaigns', campaignId: null, journeyId: null, page: 0, pageSize: 20, snapshotAt: '2026-11-04T01:00:00Z', total: 0, all: 0, statusCounts: {}, records: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ email: 'admin@example.invalid' }); mocks.limit.mockResolvedValue(null); mocks.rpc.mockResolvedValue({ data: empty, error: null }); });
describe('campaign archive endpoint', () => {
  it('authenticates and rate limits before accessing the reader', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'PRIVATE_AUTH', status: 403 }); expect((await GET(req())).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 })); const limited = await GET(req()); expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('private, no-store'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes only scoped, bounded parameters and returns private read-only data', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...empty, page: 2, kind: 'deliveries', campaignId: id }, error: null });
    const result = await GET(req('?' + new URLSearchParams({ kind: 'deliveries', campaignId: id, search: ' A,B %_* 東京 ', page: '2', status: 'uncertain' })));
    expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_campaign_archive', { p_kind: 'deliveries', p_campaign_id: id, p_journey_id: null, p_page: 2, p_search: 'A,B %_* 東京', p_status: 'uncertain', p_channel: '' });
  });
  it.each(['?page=-1', '?page=1.2', '?page=10001', '?kind=invalid', '?kind=deliveries', '?kind=events&channel=inbound&campaignId=' + id,
    '?kind=journey_events&campaignId=' + id, '?journeyId=' + id, '?search=x%00y', '?search=' + 'x'.repeat(151), '?status=' + 'x'.repeat(101), '?page=0&page=1', '?unknown=x', '?campaignId=invalid'])('rejects invalid or ambiguous input %s', async query => {
    expect((await GET(req(query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('distinguishes removed scopes and missing migrations without leaking storage errors', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(req('?campaignId=' + id))).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'PRIVATE_DB_ERROR' } });
    const response = await GET(req()); expect(response.status).toBe(503); const body = await response.json();
    expect(body.error).toContain('SQL88'); expect(JSON.stringify(body)).not.toContain('PRIVATE_DB_ERROR'); expect(body).not.toHaveProperty('total');
  });
  it.each([{ ...empty, page: 1 }, { ...empty, kind: 'deliveries' }, { ...empty, total: -1 }, { ...empty, campaignId: id },
    { ...empty, statusCounts: { sent: 2 } }, { ...empty, total: 1 }, { ...empty, records: [{ id, raw_data: 'PRIVATE_DATA' }] }])('rejects mismatched or malformed envelopes', async data => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null }); expect((await GET(req())).status).toBe(503);
  });
});
