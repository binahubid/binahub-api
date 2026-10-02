export type StandardCatalogCandidate = {
  module_code: string;
  catalog_version: string;
  pricing_unit: string;
  base_price: number | string;
  standard_scope?: string | null;
  deliverables?: string | null;
  duration_label?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function isAutoSendableStandardModule(module: StandardCatalogCandidate) {
  const metadata = module.metadata && typeof module.metadata === "object" ? module.metadata : {};
  return /^SS-\d{2}$/.test(module.module_code)
    && module.catalog_version === "signature-2026-ceo-v1"
    && module.pricing_unit === "day"
    && metadata.commercialModel === "fixed_daily"
    && metadata.requiresHumanCommercialReview !== true
    && Boolean(module.standard_scope?.trim())
    && Boolean(module.deliverables?.trim())
    && Boolean(module.duration_label?.trim())
    && Number(module.base_price) > 0;
}
