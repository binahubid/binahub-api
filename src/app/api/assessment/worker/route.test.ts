import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ process: vi.fn(), rpc: vi.fn(),personalEmail:vi.fn() }));
vi.mock('@/lib/assessment-worker', () => ({ processAssessmentJob: deps.process }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: deps.rpc }) }));
vi.mock('@/lib/individual-assessment/email',()=>({processPEReportEmail:deps.personalEmail}));
import { GET } from './route';

const request = (token = 'synthetic-scheduler-secret') => new NextRequest('https://api.example.invalid/api/assessment/worker', {
  headers: { Authorization: `Bearer ${token}` },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FOLLOW_UP_CRON_SECRET', 'synthetic-scheduler-secret');
  deps.process.mockResolvedValue({ processed: true });
  deps.personalEmail.mockResolvedValue({processed:false});
  deps.rpc.mockResolvedValue({ data: 2, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Assessment scheduler retention and legacy recovery', () => {
  it('rejects an invalid credential before cleanup or recovery', async () => {
    expect((await GET(request('incorrect'))).status).toBe(401);
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.personalEmail).not.toHaveBeenCalled();
  });
  it('runs bounded cleanup and keeps the response uncached', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true, personalDataPurged: 2,personalEmail:{processed:false} });
    expect(deps.rpc).toHaveBeenCalledWith('pe_purge_expired_participants', { p_limit: 100 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('keeps legacy assessment recovery working before SQL 65 is installed', async () => {
    deps.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true, personalDataPurged: null,personalEmail:{processed:false} });
    expect(deps.process).toHaveBeenCalledOnce();
  });
  it('isolates a cleanup transport failure without logging the sensitive error', async () => {
    deps.rpc.mockRejectedValue(new Error('PRIVATE DATABASE DETAIL'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(deps.process).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE DATABASE DETAIL');
  });
  it('returns a safe unavailable response if legacy recovery itself fails', async () => {
    deps.process.mockRejectedValue(new Error('PRIVATE DATABASE DETAIL'));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Assessment worker unavailable' });
  });
  it('isolates personal email failure from organization recovery without leaking diagnostics',async()=>{
    deps.personalEmail.mockRejectedValue(new Error('PRIVATE PROVIDER DETAIL'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    expect((await GET(request())).status).toBe(200);expect(deps.process).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE PROVIDER DETAIL');
  });
});
