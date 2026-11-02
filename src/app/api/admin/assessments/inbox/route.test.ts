import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn(), from: vi.fn(), query: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { GET } from './route';
const id = '11111111-1111-4111-8111-111111111111';
const req = (params = '') => new NextRequest('https://api.binahub.id/api/admin/assessments/inbox' + params);
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ userId: 'admin' }); mocks.limit.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: { version: 1, records: [], total: 0 }, error: null });
  mocks.from.mockReturnValue(mocks.query); mocks.query.select.mockReturnValue(mocks.query); mocks.query.eq.mockReturnValue(mocks.query);
  mocks.query.maybeSingle.mockResolvedValue({ data: null, error: null });
});
describe('admin diagnosis inbox read boundaries, no live database/model/email', () => {
  it.each(['', '?id=' + id, '?distribution=1'])('checks admin and rate limit before storage %s', async (params) => {
    mocks.auth.mockResolvedValueOnce({ error: 'private detail', status: 403 });
    expect((await GET(req(params))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(req(params))).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('passes normalized server filters as parameters, never filter syntax', async () => {
    const response = await GET(req('?page=3&search=%20PT%20A%2CB%20%25_%20&category=Profesional&employees=1000%2B&minScore=70&queue=attention&sort=attention'));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_assessment_inbox', { p_page: 3, p_search: 'PT A,B %_', p_category: 'Profesional', p_employees: '1000+', p_min_score: 70, p_queue: 'attention', p_sort: 'attention' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each(['?page=-1', '?page=10001', '?page=0.5', '?search=a%00b', '?search=' + 'x'.repeat(151), '?minScore=101', '?queue=sql', '?sort=sql', '?unknown=x', '?id=nope', '?id=' + id + '&page=0', '?distribution=0'])('rejects invalid filters %s', async (params) => {
    expect((await GET(req(params))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it('reports missing SQL82 without inventing empty results or exposing DB diagnostics', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'private@example.invalid' } });
    const response = await GET(req()); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.error).toContain('SQL82'); expect(body).not.toHaveProperty('total'); expect(JSON.stringify(body)).not.toContain('private@example');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect((await GET(req())).status).toBe(503);
  });
  it('returns a single normalized detail with scoped lead context, not the full source row', async () => {
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id, lead_id: 'lead-id', form_data: { role: 'HR', answers: { '1': 4 } }, scores: { overall: 67.4 }, category: 'Profesional', ai_analysis: 'Dimensi organisasi.', recommendations: [], created_at: '2026-10-01', private_secret: 'PRIVATE' }, error: null });
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { name: 'Nadia', company: 'Nusantara', email: 'nadia@example.invalid', lead_score_rule_version: 'legacy' }, error: null });
    const response = await GET(req('?id=' + id)); expect(response.status).toBe(200);
    expect((await response.json()).record).toMatchObject({ id, name: 'Nadia', company: 'Nusantara', overallScore: 67, aiAnalysis: 'Area organisasi.', answers: { '1': 4 }, recordedLeadScoreRuleVersion: 'legacy' });
    expect(mocks.query.eq.mock.calls).toEqual([['id', id], ['id', 'lead-id']]); expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.query.select.mock.calls[0][0].split(',')).not.toEqual(expect.arrayContaining(['*', 'proposal_data', 'result_pdf_base64']));
  });
  it('distinguishes missing details and unavailable linked context', async () => {
    expect((await GET(req('?id=' + id))).status).toBe(404);
    mocks.query.maybeSingle.mockResolvedValueOnce({ data: { id, lead_id: 'linked' }, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'private' } });
    expect((await GET(req('?id=' + id))).status).toBe(503);
  });
  it('loads only aggregate answer counts on explicit request', async () => {
    const counts = Array.from({ length: 49 }, (_, i) => ({ question: 'Q' + (i + 1), '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 }));
    mocks.rpc.mockResolvedValueOnce({ data: counts, error: null });
    const response = await GET(req('?distribution=1')); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, answerDistribution: counts });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_assessment_answer_distribution'); expect(mocks.from).not.toHaveBeenCalled();
  });
});
