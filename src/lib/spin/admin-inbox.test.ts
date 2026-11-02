import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpinInboxQuerySchema, spinContactSearchFilter } from './admin-inbox';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), from: vi.fn(), query: { select: vi.fn(), not: vi.fn(), or: vi.fn(), order: vi.fn(), range: vi.fn() } }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/admin-auth', () => ({ requireAdmin: mocks.auth }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ from: mocks.from }) }));
import { GET } from '@/app/api/admin/discovery/route';

const db = new PGlite();
afterAll(async () => { await db.close(); });
const request = (query = '') => new NextRequest('https://api.binahub.id/api/admin/discovery' + query);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ userId: 'admin-id' });
  mocks.limit.mockResolvedValue(null);
  mocks.from.mockReturnValue(mocks.query);
  for (const name of ['select', 'not', 'or', 'order'] as const) mocks.query[name].mockReturnValue(mocks.query);
  mocks.query.range.mockResolvedValue({ data: [], error: null, count: 0 });
});

describe('SPIN archive inbox (synthetic, read-only)', () => {
  it('keeps authentication and rate limits before storage', async () => {
    mocks.auth.mockResolvedValueOnce({ error: 'Denied', status: 403 });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    mocks.limit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await GET(request())).status).toBe(429);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('filters all submitted contacts before the exact count and bounded page', async () => {
    const row = { id: 'old-record', contact: { company: 'Arunika' } };
    mocks.query.range.mockResolvedValueOnce({ data: [row], error: null, count: 42 });
    const response = await GET(request('?page=1&search=%20Arunika%20'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, records: [row], total: 42, page: 1, searchApplied: true });
    expect(mocks.query.or).toHaveBeenCalledWith(spinContactSearchFilter('Arunika'));
    expect(mocks.query.not).toHaveBeenCalledWith('submitted_at', 'is', null);
    expect(mocks.query.range).toHaveBeenCalledWith(20, 39);
    expect(mocks.query.or.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.range.mock.invocationCallOrder[0]);
    expect(mocks.query.select.mock.calls[0][0]).not.toMatch(/answers|report|summary|marketing_consent/);
    expect(mocks.query.order.mock.calls).toEqual([['submitted_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it.each(['?page=-1', '?page=1.2', '?page=10001', '?search=' + 'a'.repeat(151), '?search=a%00b', '?search=a%0Ab'])('rejects invalid query %s before storage', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('omits an empty filter and does not expose storage diagnostics', async () => {
    expect(await (await GET(request('?search=%20'))).json()).toMatchObject({ records: [], total: 0, page: 0 });
    expect(mocks.query.or).not.toHaveBeenCalled();
    mocks.query.range.mockResolvedValueOnce({ data: null, error: { message: 'private@example.invalid' }, count: null });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private@example.invalid');
  });

  it.each([{ data: [], count: null }, { data: null, count: 0 }])('never converts unavailable storage evidence into a healthy empty inbox', async (payload) => {
    mocks.query.range.mockResolvedValueOnce({ ...payload, error: null });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('total');
  });

  it.each(['PT A, B (HQ)', 'O\'Brien "Utama"', '100%_unit*', 'a.b+[c](d)?{2}|^$', 'path\\branch', 'Nusantara 東京'])('quotes filter syntax and matches %s literally in PostgreSQL', async (search) => {
    const filter = spinContactSearchFilter(search);
    const prefix = 'contact->>name.imatch.';
    const quoted = filter.slice(prefix.length, filter.indexOf(',contact->>company.imatch.'));
    const literal = JSON.parse(quoted);
    expect(filter).toBe(['name', 'company', 'email'].map((field) => `contact->>${field}.imatch.${quoted}`).join(','));
    const result = await db.query<{ matches: boolean; misses: boolean }>('select $1::text ~* $2::text as matches, $3::text ~* $2::text as misses', ['prefix ' + search + ' suffix', literal, 'unrelated organization']);
    expect(result.rows[0]).toEqual({ matches: true, misses: false });
  });

  it('normalizes query consistently for the primary meeting inbox', () => {
    expect(SpinInboxQuerySchema.parse({ page: '2', search: '  Arunika  ' })).toEqual({ page: 2, search: 'Arunika' });
  });
});
