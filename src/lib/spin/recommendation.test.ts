import { describe, expect, it } from 'vitest';
import { buildSpinMatchingRequest, buildSpinRecommendationResult, SpinNeedsSchema, spinConsultationReasons, validateSpinMatches } from './recommendation';
import { syntheticSpinNeeds, syntheticSpinSelection } from './synthetic-fixture';

describe('SPIN evidence matching boundaries', () => {
  it('resolves public names and evidence from trusted sources, not model prose', () => {
    const result = validateSpinMatches(syntheticSpinSelection(), syntheticSpinNeeds());
    expect(result[0].name).toBe('Meeting Excellence & Facilitation');
    expect(result[0].fitEvidence[0]).toMatchObject({ answerRef: 'Q05.1', objectiveRef: 'SS-29.LO01' });
  });
  it('allows zero candidates instead of forcing a sale', () => {
    expect(buildSpinRecommendationResult(syntheticSpinNeeds(), { matches: [] })).toMatchObject({
      publicReportDraft: { recommendations: [] }, internalConsultant: { consultationReasons: ['NO_VERIFIED_CANDIDATE'], automaticDeliveryAllowed: false },
    });
  });
  it.each(['SS-00', 'SS-32', 'SS-99', 'SS-27'])('rejects unapproved candidate %s', code => {
    expect(() => validateSpinMatches(syntheticSpinSelection(code), syntheticSpinNeeds())).toThrow('SPIN_SOLUTION_OUTSIDE_SCOPE');
  });
  it('accepts the special route only after explicit spiritual consent', () => {
    expect(validateSpinMatches(syntheticSpinSelection('SS-27'), syntheticSpinNeeds({ spiritualOptIn: 'yes' }))).toHaveLength(1);
  });
  it('rejects cross-product objectives', () => {
    expect(() => validateSpinMatches(syntheticSpinSelection('SS-29', 'SS-07.LO02'), syntheticSpinNeeds())).toThrow('SPIN_EVIDENCE_REFERENCE_INVALID');
  });
  it('rejects nonexistent answer references', () => {
    const selection = syntheticSpinSelection(); selection.matches[0].evidenceLinks[0].evidenceId = 'Q05.99';
    expect(() => validateSpinMatches(selection, syntheticSpinNeeds())).toThrow('SPIN_EVIDENCE_REFERENCE_INVALID');
  });
  it('requires both problem and desired-outcome evidence for every candidate', () => {
    const selection = syntheticSpinSelection(); selection.matches[0].evidenceLinks[1].evidenceId = 'Q06';
    expect(() => validateSpinMatches(selection, syntheticSpinNeeds({ evidence: [
      ...syntheticSpinNeeds().evidence, { id: 'Q06', text: 'Kesepakatan tidak dicatat.' },
    ] }))).toThrow('SPIN_EVIDENCE_INCOMPLETE');
  });
  it('rejects duplicate solutions and duplicate links', () => {
    const selection = syntheticSpinSelection();
    expect(() => validateSpinMatches({ matches: [selection.matches[0], selection.matches[0]] }, syntheticSpinNeeds())).toThrow('SPIN_DUPLICATE_SOLUTION');
    selection.matches[0].evidenceLinks.push(selection.matches[0].evidenceLinks[0]);
    expect(() => validateSpinMatches(selection, syntheticSpinNeeds())).toThrow('SPIN_EVIDENCE_REFERENCE_INVALID');
  });
  it.each(['price', 'confidence', 'name', 'scope', 'sendEmail', 'fitReason'])('rejects model-invented %s fields', field => {
    const selection = syntheticSpinSelection();
    expect(() => validateSpinMatches({ matches: [{ ...selection.matches[0], [field]: 'untrusted' }] }, syntheticSpinNeeds())).toThrow();
  });
  it.each(['edited', 'supplemented', 'unconfirmed'] as const)('does not accept recommendations on %s summary', summaryStatus => {
    expect(() => validateSpinMatches(syntheticSpinSelection(), syntheticSpinNeeds({ summaryStatus }))).toThrow('SPIN_EVIDENCE_NOT_READY');
  });
  it('rejects contact data and extra request fields', () => {
    expect(() => SpinNeedsSchema.parse({ ...syntheticSpinNeeds(), email: 'private@example.invalid' })).toThrow();
    expect(() => SpinNeedsSchema.parse({ ...syntheticSpinNeeds(), company: 'Private Organization' })).toThrow();
  });
  it.each(['private@example.invalid', '+62 812-3456-7890', '1234567890123456', 'Bearer private-token', 'api_key=private', 'https://private.invalid'])('rejects common personal/secret patterns in evidence: %s', text => {
    expect(() => SpinNeedsSchema.parse(syntheticSpinNeeds({ evidence: [{ id: 'Q13', text }] }))).toThrow();
  });
  it('does not forward additional input fields, prices, or contact metadata into the prompt', () => {
    const request = buildSpinMatchingRequest(syntheticSpinNeeds());
    const payload = JSON.parse(request.messages[1].content);
    expect(Object.keys(payload.needs).sort()).toEqual(['audience', 'barriers', 'evidence', 'priorOutcome', 'problemCluster', 'programScope']);
    expect(request.messages[1].content).not.toMatch(/dailyRateIdr|priceEvidence|sourceText|SS-32/);
  });
  it('does not promote structural validation into accuracy or public confidence', () => {
    const result = buildSpinRecommendationResult(syntheticSpinNeeds(), syntheticSpinSelection());
    expect(Object.keys(result.publicReportDraft)).toEqual(['recommendations']);
    expect(result.internalConsultant).toMatchObject({ releaseStatus: 'prepared_not_active', automaticDeliveryAllowed: false,
      validationStatus: 'references_checked_not_semantically_validated' });
  });
  it('records substantive system and application barriers without guessing a diagnosis', () => {
    expect(spinConsultationReasons(syntheticSpinNeeds({ barriers: ['B1', 'B2', 'B3'] }))).toEqual(['SYSTEM_BARRIERS', 'IMPLEMENTATION_SUPPORT']);
    expect(spinConsultationReasons(syntheticSpinNeeds({ barriers: ['B2', 'B3'] }))).toEqual(['IMPLEMENTATION_SUPPORT']);
  });
  it('holds strategic, broad, large, unknown and conflicting scopes for consultation', () => {
    expect(spinConsultationReasons(syntheticSpinNeeds({ problemCluster: 'C10', programScope: 'organization', participantCount: 151,
      conflicts: ['timing'], priorOutcome: 'reverted' }))).toEqual(['STRATEGIC_SCOPE', 'ANSWER_CONFLICT', 'ORGANIZATION_SCOPE', 'OVER_150_PARTICIPANTS', 'IMPLEMENTATION_SUPPORT']);
    expect(spinConsultationReasons(syntheticSpinNeeds({ participantCount: null }))).toContain('SCOPE_INCOMPLETE');
  });
});
