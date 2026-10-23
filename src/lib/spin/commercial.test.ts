import { describe, expect, it } from 'vitest';
import { quoteSpinCatalogBase } from './commercial';
import { syntheticSpinNeeds } from './synthetic-fixture';

const scope = { solutionCodes: ['SS-29'], days: 1, batches: 1, format: 'company_workshop', additionalNeeds: [] };

describe('CEO-approved SPIN base pricing', () => {
  it('quotes the fixed daily base once, not per participant or organization employee count', () => {
    const result = quoteSpinCatalogBase(syntheticSpinNeeds(), scope);
    expect(result.publicInvestment).toMatchObject({ baseAmountIdr: 25_000_000, currency: 'IDR',
      included: ['Trainer/fasilitator', 'Modul pelatihan'], finalTotalIdr: null });
    expect(result.internalCommercial).toMatchObject({ pricingStatus: 'indicative', taxTreatment: 'not_confirmed', automaticDeliveryAllowed: false });
    expect(result).not.toHaveProperty('validityDays');
    expect(result).not.toHaveProperty('expiresAt');
  });
  it('quotes two catalog days only when that duration actually exists for the product', () => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, solutionCodes: ['SS-07'], days: 2 }).publicInvestment.baseAmountIdr).toBe(50_000_000);
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, days: 2 }).publicInvestment.baseAmountIdr).toBeNull();
  });
  it('uses SS-22 special rate and its two-day minimum', () => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, solutionCodes: ['SS-22'], days: 2 }).publicInvestment.baseAmountIdr).toBe(60_000_000);
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, solutionCodes: ['SS-22'] }).publicInvestment.baseAmountIdr).toBeNull();
  });
  it.each([1, 20, 30])('uses the same catalog base within capacity: %i participants', participantCount => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds({ participantCount }), scope).publicInvestment.baseAmountIdr).toBe(25_000_000);
  });
  it.each([31, 60, 151, null])('does not extrapolate unknown/excess participants: %s', participantCount => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds({ participantCount }), scope).publicInvestment.baseAmountIdr).toBeNull();
  });
  it.each([0.5, 2, 10, null])('does not invent a rate for SS-29 duration %s days', days => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, days }).publicInvestment.baseAmountIdr).toBeNull();
  });
  it.each(['SS-11', 'SS-18', 'SS-27'])('does not treat package/custom %s as a daily workshop', code => {
    const result = quoteSpinCatalogBase(syntheticSpinNeeds({ spiritualOptIn: 'yes' }), { ...scope, solutionCodes: [code] });
    expect(result.publicInvestment.baseAmountIdr).toBeNull();
    expect(result.internalCommercial.consultationReasons).toContain('NON_DAILY_PRICING');
  });
  it.each(['venue', 'travel', 'accommodation', 'equipment', 'follow_up', 'custom_content', 'other'])('routes additional %s to consultation without adding a guessed fee', extra => {
    const result = quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, additionalNeeds: [extra] });
    expect(result.publicInvestment.baseAmountIdr).toBeNull();
    expect(result.internalCommercial.consultationReasons).toContain('ADDITIONAL_NEEDS');
  });
  it('routes multi-batch and combined interventions to consultation', () => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, batches: 2 }).publicInvestment.baseAmountIdr).toBeNull();
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, solutionCodes: ['SS-29', 'SS-28'] }).publicInvestment.baseAmountIdr).toBeNull();
  });
  it.each(['public_class', 'coaching', 'unknown'])('does not reuse a corporate daily fee as %s pricing', format => {
    expect(quoteSpinCatalogBase(syntheticSpinNeeds(), { ...scope, format }).publicInvestment.baseAmountIdr).toBeNull();
  });
  it('withholds pricing for conflicts, unconfirmed needs and system/application constraints', () => {
    for (const overrides of [{ summaryStatus: 'edited' as const }, { barriers: ['B1' as const, 'B2' as const] }, { priorOutcome: 'reverted' as const }, { problemCluster: 'C9' as const }]) {
      expect(quoteSpinCatalogBase(syntheticSpinNeeds(overrides), scope).publicInvestment.baseAmountIdr).toBeNull();
    }
  });
  it('rejects price/discount/tax tampering, unknown codes and invalid numeric values', () => {
    for (const input of [{ ...scope, basePrice: 1 }, { ...scope, taxPercent: 0 }, { ...scope, discount: 100 },
      { ...scope, solutionCodes: ['SS-32'] }, { ...scope, days: 0 }, { ...scope, batches: 0 },
      { ...scope, solutionCodes: ['SS-29', 'SS-29'] }]) expect(() => quoteSpinCatalogBase(syntheticSpinNeeds(), input)).toThrow();
  });
  it('never leaks raw review codes, internal metadata or invented totals into the public investment', () => {
    const result = quoteSpinCatalogBase(syntheticSpinNeeds({ barriers: ['B3'] }), scope);
    expect(JSON.stringify(result.publicInvestment)).not.toMatch(/IMPLEMENTATION_SUPPORT|pricingStatus|pricingVersion|automaticDelivery/);
    expect(result.publicInvestment.finalTotalIdr).toBeNull();
  });
});
