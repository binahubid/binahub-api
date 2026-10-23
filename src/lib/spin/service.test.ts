import { beforeEach, describe, expect, it, vi } from 'vitest';
const routed = vi.hoisted(() => vi.fn());
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai-provider', () => ({ callRoutedAI: routed }));
import { prepareSpinRecommendation } from './service';
import { syntheticSpinNeeds, syntheticSpinSelection } from './synthetic-fixture';

describe('SPIN AI adapter (mocked; no provider or email calls)', () => {
  beforeEach(() => { routed.mockReset(); });
  it('uses existing provider settings and bounded JSON validation without introducing an SDK/key', async () => {
    routed.mockImplementation(async input => {
      const content = JSON.stringify(syntheticSpinSelection()); input.validateContent(content);
      return { content, provider: 'lapakvip', model: 'synthetic' };
    });
    const result = await prepareSpinRecommendation(syntheticSpinNeeds());
    expect(result.publicReportDraft.recommendations[0].solutionCode).toBe('SS-29');
    expect(routed).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'reasoning', jsonMode: true,
      budget: { maxTokens: 1200, perAttemptTimeoutMs: 10_000, totalTimeoutMs: 25_000 } }));
    expect(routed.mock.calls[0][0]).not.toHaveProperty('environment');
    expect(result.internalConsultant.automaticDeliveryAllowed).toBe(false);
  });
  it.each(['edited', 'unconfirmed'] as const)('does not call AI before %s summary is confirmed', async summaryStatus => {
    const result = await prepareSpinRecommendation(syntheticSpinNeeds({ summaryStatus }));
    expect(routed).not.toHaveBeenCalled(); expect(result.publicReportDraft.recommendations).toEqual([]);
  });
  it('does not call AI when the desired outcome is missing', async () => {
    await prepareSpinRecommendation(syntheticSpinNeeds({ evidence: [{ id: 'Q05', text: 'Kebutuhan belum jelas.' }] }));
    expect(routed).not.toHaveBeenCalled();
  });
  it.each(['not JSON', '{"matches":[] ,"price":1}', JSON.stringify(syntheticSpinSelection('SS-32')), 'x'.repeat(16_385)])('never turns invalid output into a default sale: case %#', async content => {
    routed.mockResolvedValue({ content });
    const result = await prepareSpinRecommendation(syntheticSpinNeeds());
    expect(result.publicReportDraft.recommendations).toEqual([]);
    expect(result.internalConsultant.consultationReasons).toContain('AI_MATCH_UNAVAILABLE');
  });
  it('returns safe consultation fallback, not provider errors or private request data', async () => {
    routed.mockRejectedValue(new Error('private@example.invalid provider-secret'));
    const result = await prepareSpinRecommendation(syntheticSpinNeeds());
    expect(JSON.stringify(result)).not.toMatch(/private@example|provider-secret/);
    expect(result.publicReportDraft.recommendations).toEqual([]);
  });
  it('rejects personal input before any provider call', async () => {
    await expect(prepareSpinRecommendation(syntheticSpinNeeds({ evidence: [{ id: 'Q13', text: 'private@example.invalid' }] }))).rejects.toThrow();
    expect(routed).not.toHaveBeenCalled();
  });
  it('takes an input snapshot before awaiting the provider', async () => {
    const input = syntheticSpinNeeds();
    routed.mockImplementation(async () => {
      input.spiritualOptIn = 'yes'; input.evidence[0].text = 'Modified';
      return { content: JSON.stringify(syntheticSpinSelection()) };
    });
    const result = await prepareSpinRecommendation(input);
    expect(result.publicReportDraft.recommendations[0].fitEvidence[0].answer).not.toBe('Modified');
  });
});
