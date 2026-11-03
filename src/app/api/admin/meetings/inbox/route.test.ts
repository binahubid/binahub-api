import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
import { GET } from './route';
const id = '00000000-0000-4000-8000-000000000001';
const req = (query = '') => new NextRequest('https://api.example.invalid/api/admin/meetings/inbox' + query);
const inbox = { version: 1, page: 0, pageSize: 20, total: 0, records: [], timeZone: 'Asia/Jakarta' };
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ email: 'admin@example.invalid' }); mocks.limit.mockResolvedValue(null); mocks.rpc.mockResolvedValue({ data: inbox, error: null }); });
describe('read-only consultation endpoint', () => {
  it('authenticates and limits before list or detail reads', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'PRIVATE_AUTH', status: 403 }); expect((await GET(req('?id=' + id))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled(); mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(req())).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes bounded literal filters and returns private no-store data', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...inbox, page: 2 }, error: null });
    const response = await GET(req('?' + new URLSearchParams({ page: '2', search: ' A,B %_* 東京 ', view: 'review', status: 'unknown' })));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_meetings_inbox', { p_page: 2, p_search: 'A,B %_* 東京', p_view: 'review', p_status: 'unknown' });
  });
  it.each(['?page=-1', '?page=1.2', '?page=10001', '?view=invalid', '?search=x%00y', '?search=' + 'x'.repeat(151), '?status=' + 'x'.repeat(101), '?page=0&page=1', '?unknown=x', '?id=invalid', '?id=' + id + '&view=all'])('rejects invalid/ambiguous queries %s', async query => {
    expect((await GET(req(query))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reads one exact detail; distinguishes missing, wrong-id and unavailable storage', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { id }, error: null }); expect((await GET(req('?id=' + id))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith('admin_meeting_detail', { p_id: id });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(req('?id=' + id))).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({ data: { id: 'other' }, error: null }); expect((await GET(req('?id=' + id))).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'PRIVATE_DB' } });
    const response = await GET(req()); expect(response.status).toBe(503); const value = await response.json();
    expect(value.error).toContain('SQL87'); expect(JSON.stringify(value)).not.toContain('PRIVATE_DB'); expect(value).not.toHaveProperty('total');
  });
  it.each([null, { ...inbox, page: 1 }, { ...inbox, total: -1 }, { ...inbox, timeZone: 'device' }])('rejects malformed list envelopes', async data => {
    mocks.rpc.mockResolvedValueOnce({ data, error: null }); expect((await GET(req())).status).toBe(503);
  });
});
