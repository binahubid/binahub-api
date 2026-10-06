import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: vi.fn(), rpc: vi.fn(), ai: vi.fn(), email: vi.fn(), pdf: vi.fn(), writes: [] as { table: string; patch: Record<string, unknown> }[] }));
vi.mock('./supabase', () => ({ createServerSupabase: mocks.db }));
vi.mock('./ai-service', () => ({ analyzeAssessment: mocks.ai }));
vi.mock('./email-service', () => ({ sendAssessmentEmail: mocks.email }));
vi.mock('./pdf-service', () => ({ generatePDFBuffer: mocks.pdf }));
import { processAssessmentJob } from './assessment-worker';
const form = { name: 'Internal', company: 'Test', email: 'internal@example.com', answers: Object.fromEntries(Array.from({ length: 49 }, (_, i) => [String(i + 1), 3])) };
const analysis = { scores: { overall: 60 }, category: 'Berkembang', analysis: 'Area Works', recommendations: [] };
beforeEach(() => {
  vi.resetAllMocks(); mocks.writes.length = 0;
  mocks.rpc.mockResolvedValue({ data: [{ assessment_id: 'a', lease_token: 'lease', attempts: 1, ai_result: null }], error: null });
  mocks.ai.mockResolvedValue(analysis); mocks.pdf.mockResolvedValue(Buffer.from('pdf')); mocks.email.mockResolvedValue({ clientEmailId: 'mail' });
  mocks.db.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const q = { select: () => q, eq: () => q,
      update: (patch: Record<string, unknown>) => { mocks.writes.push({ table, patch }); return q; },
      insert: (patch: Record<string, unknown>) => { mocks.writes.push({ table, patch }); return q; },
      single: async () => ({ data: table === 'assessments' ? { id: 'a', lead_id: 'lead', form_data: form, result_email_sent_at: null } : { assessment_id: 'a' }, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ error: null }),
    }; return q;
  } });
});
describe('assessment worker', () => {
  it('persists analysis and marks the send boundary before sending once', async () => {
    mocks.email.mockImplementation(async () => {
      expect(mocks.writes.some(w => w.table === 'assessment_jobs' && w.patch.status === 'emailing')).toBe(true);
      return { clientEmailId: 'mail' };
    });
    expect(await processAssessmentJob('a')).toMatchObject({ status: 'completed' });
    expect(mocks.email).toHaveBeenCalledOnce();
    expect(mocks.writes.some(w => w.patch.result_email_id === 'mail')).toBe(true);
  });
  it('retries an AI failure without contacting the email provider', async () => {
    mocks.ai.mockRejectedValue(new Error('AI timeout'));
    expect(await processAssessmentJob('a')).toMatchObject({ status: 'pending' });
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('retries PDF creation rather than announcing an absent attachment', async () => {
    mocks.pdf.mockRejectedValue(new Error('Render failed'));
    expect(await processAssessmentJob('a')).toMatchObject({ status: 'pending' });
    expect(mocks.email).not.toHaveBeenCalled();
  });
  it('holds unknown provider outcomes for reconciliation, not automatic retry', async () => {
    mocks.email.mockRejectedValue(new Error('Network interrupted'));
    expect(await processAssessmentJob('a')).toMatchObject({ status: 'uncertain' });
    expect(mocks.writes.some(w => w.patch.status === 'pending')).toBe(false);
  });
  it('reuses saved AI output after an interrupted analysis phase', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ assessment_id: 'a', lease_token: 'lease', attempts: 2, ai_result: analysis }], error: null });
    await processAssessmentJob('a'); expect(mocks.ai).not.toHaveBeenCalled();
  });
  it('does nothing when another worker already owns the job', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await processAssessmentJob('a')).toEqual({ processed: false });
    expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.email).not.toHaveBeenCalled();
  });
});
