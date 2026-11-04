import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const deps = vi.hoisted(() => ({ admin: vi.fn(), limit: vi.fn(), pe: vi.fn(), rm: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: deps.admin }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: deps.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({}) }));
vi.mock('./definition', async importOriginal => ({ ...await importOriginal<typeof import('./definition')>(), loadPEInstrument: deps.pe }));
vi.mock('../relationship-management/instrument', async importOriginal => ({ ...await importOriginal<typeof import('../relationship-management/instrument')>(), loadRMInstrument: deps.rm }));
import { makeSyntheticPEInstrument } from './synthetic-fixture';
import { trialDefinition } from './trial';
import { GET, POST } from '@/app/api/admin/assessments/individual/trial/route';
const url = 'https://synthetic.invalid/api/admin/assessments/individual/trial';
const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); deps.admin.mockResolvedValue({ userId: 'synthetic-admin' }); deps.limit.mockResolvedValue(null); deps.pe.mockResolvedValue(makeSyntheticPEInstrument()); });
describe('admin-only, non-commercial demo route', () => {
  it.each([401, 403])('denies %s before private loading or scoring', async status => {
    deps.admin.mockResolvedValue({ error: 'Denied', status });
    expect((await GET(new NextRequest(url + '?product=pe'))).status).toBe(status);
    expect((await POST(post({}))).status).toBe(status);
    expect(deps.pe).not.toHaveBeenCalled(); expect(deps.rm).not.toHaveBeenCalled();
  });
  it('enforces rate limit and never silently substitutes a missing private bank', async () => {
    deps.limit.mockResolvedValue(NextResponse.json({ error: 'Limit' }, { status: 429 }));
    expect((await GET(new NextRequest(url + '?product=pe'))).status).toBe(429); expect(deps.pe).not.toHaveBeenCalled();
    deps.limit.mockResolvedValue(null); deps.rm.mockResolvedValue(null);
    expect((await GET(new NextRequest(url + '?product=rm'))).status).toBe(503);
    deps.pe.mockRejectedValue(new Error('PRIVATE_SOURCE_ERROR'));
    const r = await GET(new NextRequest(url + '?product=pe')); expect(r.status).toBe(503); expect(await r.text()).not.toContain('PRIVATE_');
  });
  it('returns no-store safe definitions, and rejects products/partial or stale answers', async () => {
    expect((await GET(new NextRequest(url + '?product=le'))).status).toBe(400);
    const response = await GET(new NextRequest(url + '?product=pe'));
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const d = await response.json(); expect(d.definition.selfReportItems).toHaveLength(24); expect(d.definition.sjtItems).toHaveLength(12);
    expect((await POST(post({ product: 'pe', revision: d.revision, responses: {} }))).status).toBe(422);
    expect((await POST(post({ product: 'pe', revision: '0'.repeat(64), responses: {} }))).status).toBe(409);
    expect((await POST(post({ product: 'pe', revision: d.revision, responses: {}, paymentStatus: 'paid' }))).status).toBe(400);
  });
  it('scores complete submissions with actual scorer without writes or emails', async () => {
    const source = makeSyntheticPEInstrument(), d = trialDefinition({ product: 'pe', instrument: source });
    const responses = Object.fromEntries([...d.definition.selfReportItems.map(q => [q.id, 5]), ...d.definition.sjtItems.map(q => [q.id, 'A'])]);
    const result = await POST(post({ product: 'pe', revision: d.revision, responses }));
    expect(result.status).toBe(200); expect((await result.json()).report.moduleProfile.combined).toBe(100);
    expect(deps.pe).toHaveBeenCalledTimes(1);
  });
  it('bounds request size and requires JSON', async () => {
    expect((await POST(new NextRequest(url, { method: 'POST', body: 'bad' }))).status).toBe(400);
    expect((await POST(post({ large: 'x'.repeat(17000) }))).status).toBe(400);
  });
});
