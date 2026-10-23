import { z } from 'zod';
import { SPIN_CATALOG } from './catalog';
import { SpinNeedsSchema, spinConsultationReasons, spinHasRequiredEvidence } from './recommendation';

export const SPIN_PRICE_VERSION = 'spin-catalog-base-ceo-2026-10-22-v1';
const scopeSchema = z.object({
  solutionCodes: z.array(z.string().regex(/^SS-\d{2}$/)).min(1).max(3),
  days: z.number().positive().max(365).nullable(),
  batches: z.number().int().positive().max(1000).nullable(),
  additionalNeeds: z.array(z.enum(['venue', 'travel', 'accommodation', 'equipment', 'follow_up', 'custom_content', 'other'])).max(7)
    .refine(items => new Set(items).size === items.length),
  format: z.enum(['company_workshop', 'public_class', 'coaching', 'unknown']),
}).strict();

/** Base investment only. No tax percentage, add-on, discount or final total is invented. */
export function quoteSpinCatalogBase(needsInput: unknown, scopeInput: unknown) {
  const needs = SpinNeedsSchema.parse(needsInput), scope = scopeSchema.parse(scopeInput);
  if (new Set(scope.solutionCodes).size !== scope.solutionCodes.length) throw new Error('SPIN_DUPLICATE_SOLUTION');
  const modules = scope.solutionCodes.map(code => {
    const product = SPIN_CATALOG.modules.find(item => item.code === code);
    if (!product || product.code === 'SS-27' && needs.spiritualOptIn !== 'yes') throw new Error('SPIN_SOLUTION_OUTSIDE_SCOPE');
    return product;
  });
  const reasons = spinConsultationReasons(needs);
  if (!spinHasRequiredEvidence(needs)) reasons.push('NEEDS_CLARIFICATION');
  if (scope.solutionCodes.length !== 1) reasons.push('COMBINED_INTERVENTIONS');
  if (scope.format !== 'company_workshop') reasons.push('FORMAT_REQUIRES_CONSULTATION');
  if (scope.batches !== 1) reasons.push('BATCH_SCOPE_REQUIRES_CONSULTATION');
  if (scope.additionalNeeds.length) reasons.push('ADDITIONAL_NEEDS');
  if (needs.participantCount !== null && needs.participantCount > 30) reasons.push('CAPACITY_REQUIRES_CONSULTATION');
  for (const product of modules) {
    if (product.dailyRateIdr === null) reasons.push('NON_DAILY_PRICING');
    if (scope.days === null || !product.allowedDays.includes(scope.days)) reasons.push('DURATION_REQUIRES_CONSULTATION');
  }
  const reviewReasons = [...new Set(reasons)];
  const baseAmountIdr = reviewReasons.length ? null : modules[0].dailyRateIdr! * scope.days!;
  if (baseAmountIdr !== null && !Number.isSafeInteger(baseAmountIdr)) throw new Error('SPIN_PRICE_INVALID');
  return {
    publicInvestment: {
      baseAmountIdr, currency: 'IDR' as const,
      included: ['Trainer/fasilitator', 'Modul pelatihan'],
      taxNote: 'Ketentuan pajak perlu dikonfirmasi.', finalTotalIdr: null,
      scopeNote: reviewReasons.length ? 'Ruang lingkup dan investasi perlu dibahas saat konsultasi.'
        : 'Investasi dasar untuk satu program dan satu batch sesuai durasi serta kapasitas katalog. Kebutuhan di luar cakupan dibahas saat konsultasi.',
    },
    internalCommercial: {
      pricingVersion: SPIN_PRICE_VERSION, catalogVersion: SPIN_CATALOG.catalogVersion,
      pricingStatus: reviewReasons.length ? 'manual_review' as const : 'indicative' as const,
      consultationReasons: reviewReasons, taxTreatment: 'not_confirmed' as const,
      releaseStatus: 'prepared_not_active' as const, automaticDeliveryAllowed: false as const,
    },
  };
}
