import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), limit: vi.fn(), worker: vi.fn(), after: vi.fn(), existing: null as null | Record<string, unknown>, missingQueue: false }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: mocks.db }));
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('@/lib/assessment-worker', () => ({ processAssessmentJob: mocks.worker }));
vi.mock('next/server', async (original) => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
import { POST } from './route';
const form = { name: 'Internal', company: 'Demo', email: 'internal@example.com', answers: Object.fromEntries(Array.from({ length: 49 }, (_, i) => [String(i + 1), 3])) };
const request = (body: unknown = form) => new NextRequest('https://api.example.com/api/assessment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'stable-request-key' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.existing = null; mocks.missingQueue = false;
  mocks.limit.mockResolvedValue(null); mocks.worker.mockResolvedValue({ processed: true });
  mocks.db.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: null, error: null }), from: (table: string) => {
    const q = { select: () => q, eq: () => q, insert: () => q, upsert: () => q,
      limit: async () => ({ data: [], error: mocks.missingQueue ? { message: 'missing queue' } : null }),
      maybeSingle: async () => ({ data: mocks.existing, error: null }),
      single: async () => ({ data: table === 'leads' ? { id: 'lead' } : table === 'assessment_jobs' ? { assessment_id: 'saved' } : { id: 'saved' }, error: null }),
    }; return q;
  } });
});
describe('assessment acceptance', () => {
  it('returns 202 before running AI, PDF or email', async () => {
    const result = await POST(request());
    expect(result.status).toBe(202); expect(await result.json()).toMatchObject({ success: true, assessmentId: 'saved', processing: true });
    expect(mocks.worker).not.toHaveBeenCalled(); expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0](); expect(mocks.worker).toHaveBeenCalledWith('saved');
  });
  it('accepts a retry of the same pending submission without duplicate work', async () => {
    mocks.existing = { id: 'existing', result_email_sent_at: null };
    const result = await POST(request()); expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ assessmentId: 'existing', reused: true });
  });
  it('rejects invalid or incomplete answers rather than showing a false receipt', async () => {
    expect((await POST(request({ ...form, answers: {} }))).status).toBe(400);
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it('fails closed before acceptance if the queue migration is missing', async () => {
    mocks.missingQueue = true; expect((await POST(request())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
