import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn(), from: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const req = (params = '') => new NextRequest('https://api.example.invalid/api/admin/inquiries/inbox' + params);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ userId: 'admin' }); mocks.limit.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: { version: 1, records: [], total: 0 }, error: null });
  mocks.from.mockReturnValue(mocks.query); mocks.query.select.mockReturnValue(mocks.query); mocks.query.eq.mockReturnValue(mocks.query);
  mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
describe('read-only admin Inquiry inbox boundaries', () => {
  it.each(['', '?id=' + id])('checks identity/rate limit before data %s', async (params) => {
    mocks.auth.mockResolvedValueOnce({ error: 'private', status: 403 });
    expect((await GET(req(params))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(req(params))).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('passes literal search/filter/page parameters and prevents shared caching', async () => {
    const response = await GET(req('?' + new URLSearchParams({ page: '2', search: '  A,B "O\'Brien" %_* 東京  ', source: 'catalog_request', status: 'Diproses' })));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_inquiry_inbox', { p_page: 2, p_search: 'A,B "O\'Brien" %_* 東京', p_source: 'catalog_request', p_status: 'Diproses' });
    expect(response.headers.get('cache-control')).toContain('no-store'); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(['?page=-1','?page=10001','?page=1.5','?page=x','?search=a%00b','?search='+'x'.repeat(151),'?source=a%0Ab','?status='+'x'.repeat(151),'?unknown=x','?id=nope','?id='+id+'&page=0','?page=0&page=1','?id='+id+'&id='+id])('rejects invalid or ambiguous input %s', async (params) => {
    expect((await GET(req(params))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('does not turn unavailable storage into zero or leak diagnostics', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'secret@example.invalid' } });
    const response = await GET(req()); expect(response.status).toBe(503); const body = await response.json();
    expect(body.error).toContain('SQL83'); expect(body).not.toHaveProperty('total'); expect(JSON.stringify(body)).not.toContain('secret@');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(req())).status).toBe(503);
    mocks.rpc.mockRejectedValueOnce(new Error('private DB')); expect((await GET(req())).status).toBe(503);
  });
  it('reads one complete detail using scoped columns, preserving reply/module data', async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id, name: 'Maya', email: 'maya@example.invalid', message: 'Full context', admin_notes: 'Keep notes', reply_body: 'Reviewed response', reply_status: 'reviewed', module_request_data: '{"individualAttemptId":"attempt"}', secret: 'PRIVATE' }, error: null });
    const response = await GET(req('?id='+id)); const body = await response.json(); expect(response.status).toBe(200);
    expect(body.record).toMatchObject({ id, name: 'Maya', message: 'Full context', notes: 'Keep notes', replyBody: 'Reviewed response', replyStatus: 'reviewed', moduleRequest: { individualAttemptId: 'attempt' }, followUpPaused: false });
    expect(JSON.stringify(body)).not.toContain('PRIVATE'); expect(mocks.query.eq).toHaveBeenCalledWith('id',id); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.query.select.mock.calls[0][0].split(',')).not.toContain('*');
  });
  it('distinguishes not found from a failed detail read', async () => {
    expect((await GET(req('?id='+id))).status).toBe(404);
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'private' } }); expect((await GET(req('?id='+id))).status).toBe(503);
  });
});
