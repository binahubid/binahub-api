import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({ process: vi.fn(), rpc: vi.fn(),personalEmail:vi.fn(),discovery:vi.fn(),heartbeat:vi.fn(),consultant:vi.fn(),notifications:vi.fn() }));
vi.mock('@/lib/service-health',()=>({reportWorkerHeartbeat:deps.heartbeat}));
vi.mock('@/lib/assessment-worker', () => ({ processAssessmentJob: deps.process }));
vi.mock('@/lib/supabase', () => ({ createServerSupabase: () => ({ rpc: deps.rpc }) }));
vi.mock('@/lib/individual-assessment/email',()=>({processPEReportEmail:deps.personalEmail}));
vi.mock('@/lib/spin/worker',()=>({processSpinWork:deps.discovery}));
vi.mock('@/lib/consultant/messages',()=>({processConsultantMessage:deps.consultant}));
vi.mock('@/lib/consultant/notifications',()=>({processConsultantNotifications:deps.notifications}));
import { GET, HEAD } from './route';

const request = (token = 'synthetic-scheduler-secret') => new NextRequest('https://api.example.invalid/api/assessment/worker', {
  headers: { Authorization: `Bearer ${token}` },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FOLLOW_UP_CRON_SECRET', 'synthetic-scheduler-secret');
  deps.process.mockResolvedValue({ processed: true });
  deps.personalEmail.mockResolvedValue({processed:false});
  deps.discovery.mockResolvedValue({processed:false});
  deps.consultant.mockResolvedValue({processed:false});
  deps.notifications.mockResolvedValue({state:'ok',accepted:0,deferred:0,skipped:0});
  deps.heartbeat.mockResolvedValue(true);
  deps.rpc.mockResolvedValue({ data: 2, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('Assessment scheduler retention and legacy recovery', () => {
  it('requires Bearer authentication, not an unprefixed secret header', async () => {
    const response = await GET(new NextRequest('https://api.example.invalid/api/assessment/worker', {
      headers: { Authorization: 'synthetic-scheduler-secret' },
    }));
    expect(response.status).toBe(401);
    for (const call of Object.values(deps)) expect(call).not.toHaveBeenCalled();
  });
  it('fails closed when the server credential is missing', async () => {
    vi.stubEnv('FOLLOW_UP_CRON_SECRET', '');
    expect((await GET(request())).status).toBe(401);
    for (const call of Object.values(deps)) expect(call).not.toHaveBeenCalled();
  });
  it('rejects HEAD probes without invoking any stateful worker', () => {
    const response = HEAD();
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    for (const call of Object.values(deps)) expect(call).not.toHaveBeenCalled();
  });
  it('does not accept the cron secret in the URL instead of the Authorization header', async () => {
    const response = await GET(new NextRequest('https://api.example.invalid/api/assessment/worker?secret=synthetic-scheduler-secret'));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    for (const call of Object.values(deps)) expect(call).not.toHaveBeenCalled();
  });
  it('rejects an invalid credential before cleanup or recovery', async () => {
    expect((await GET(request('incorrect'))).status).toBe(401);
    expect(deps.rpc).not.toHaveBeenCalled();
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.personalEmail).not.toHaveBeenCalled();
    expect(deps.discovery).not.toHaveBeenCalled();
    expect(deps.heartbeat).not.toHaveBeenCalled();
  });
  it('runs bounded cleanup and keeps the response uncached', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true, personalDataPurged: 2,personalEmail:{processed:false},discovery:{processed:false},consultant:{processed:false},consultantNotifications:{state:'ok',accepted:0,deferred:0,skipped:0} });
    expect(deps.rpc).toHaveBeenCalledWith('pe_purge_expired_participants', { p_limit: 100 });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(deps.heartbeat).toHaveBeenCalledTimes(2);
    expect(deps.heartbeat.mock.calls[1][1]).toBe(deps.heartbeat.mock.calls[0][1]);
    expect(deps.heartbeat.mock.calls[1][2]).toBe('ok');
  });
  it('keeps legacy assessment recovery working before SQL 65 is installed', async () => {
    deps.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: true, personalDataPurged: null,personalEmail:{processed:false},discovery:{processed:false},consultant:{processed:false} });
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
    expect(deps.heartbeat.mock.calls.at(-1)?.[2]).toBe('error');
  });
  it('isolates personal email failure from organization recovery without leaking diagnostics',async()=>{
    deps.personalEmail.mockRejectedValue(new Error('PRIVATE PROVIDER DETAIL'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    expect((await GET(request())).status).toBe(200);expect(deps.process).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE PROVIDER DETAIL');
  });
  it('isolates SPIN recovery failure without skipping existing work or exposing diagnostics',async()=>{
    deps.discovery.mockRejectedValue(new Error('PRIVATE SPIN DETAIL'));
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    expect((await GET(request())).status).toBe(200);
    expect(deps.process).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE SPIN DETAIL');
    expect(deps.heartbeat.mock.calls.at(-1)?.[2]).toBe('degraded');
  });
  it('keeps jobs running during the SQL81 rolling deployment and marks held work as degraded',async()=>{
    deps.heartbeat.mockResolvedValue(false);
    deps.discovery.mockResolvedValue({processed:true,status:'pending'});
    expect((await GET(request())).status).toBe(200);
    expect(deps.process).toHaveBeenCalledOnce();
    expect(deps.heartbeat.mock.calls.at(-1)?.[2]).toBe('degraded');
  });
  it('continues report recovery when the AMS notification queue is unavailable', async () => {
    deps.notifications.mockRejectedValue(new Error('PRIVATE NOTIFICATION DIAGNOSTIC'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ processed: true, consultantNotifications: { state: 'degraded' } });
    expect(deps.heartbeat.mock.calls.at(-1)?.[2]).toBe('degraded');
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE NOTIFICATION DIAGNOSTIC');
  });
});
