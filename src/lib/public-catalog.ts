export type PublicCatalogModuleRow = {
  id: string;
  product_id: string;
  module_code: string;
  slug: string;
  name: string;
  description: string | null;
  standard_scope: string | null;
  deliverables: string | null;
  out_of_scope: string | null;
  duration_label: string | null;
  featured: boolean;
  display_order: number;
  catalog_version: string;
  metadata?: unknown;
};

export type PublicCatalogProductRow = {
  id: string;
  product_key: string;
  slug: string;
  name: string;
  objective: string | null;
  short_description: string | null;
  public_description: string | null;
  cover_image_url: string | null;
  featured: boolean;
  display_order: number;
};

export function buildPublicCatalog(
  products: PublicCatalogProductRow[],
  modules: PublicCatalogModuleRow[],
  locale: "id" | "en" = "id",
) {
  const englishCategories: Record<string, { name: string; description: string }> = {
    "signature-self": { name: "Self Transformation", description: "Individual and leadership development solutions." },
    "signature-team": { name: "Team Transformation", description: "Solutions for collaboration, trust, and team effectiveness." },
    "signature-organization": { name: "Organization Transformation", description: "Solutions for organizational capability and change." },
    "signature-specialized": { name: "Specialized Solutions", description: "Development journeys for specific needs." },
  };
  const localizedModule = (module: PublicCatalogModuleRow) => {
    const metadata = module.metadata && typeof module.metadata === "object" && !Array.isArray(module.metadata)
      ? module.metadata as Record<string, unknown> : {};
    const localized = metadata.localized && typeof metadata.localized === "object" && !Array.isArray(metadata.localized)
      ? metadata.localized as Record<string, unknown> : {};
    const copy = localized[locale] && typeof localized[locale] === "object" && !Array.isArray(localized[locale])
      ? localized[locale] as Record<string, unknown> : {};
    const details = (key: string) => Array.isArray(copy[key])
      ? (copy[key] as unknown[]).filter((value): value is string => typeof value === "string")
      : [];
    const field = (key: string) => typeof copy[key] === "string" ? copy[key] as string : null;
    return {
      name: field("name") || module.name,
      description: field("summary") || module.description,
      tagline: field("tagline"),
      learningObjectives: details("learningObjectives"),
      contentOutline: details("contentOutline"),
      outputs: details("outputs"),
      bestFor: field("bestFor"),
      engagementFormat: field("engagementFormat"),
      duration: field("duration") || module.duration_label,
      capacity: field("capacity"),
      serviceBrand: field("serviceBrand"),
      notes: field("notes"),
    };
  };
  const modulesByProduct = new Map<string, PublicCatalogModuleRow[]>();
  for (const catalogModule of modules) {
    const current = modulesByProduct.get(catalogModule.product_id) || [];
    current.push(catalogModule);
    modulesByProduct.set(catalogModule.product_id, current);
  }

  return products
    .map((product) => ({
      key: product.product_key,
      slug: product.slug,
      name: locale === "en" ? englishCategories[product.product_key]?.name || product.name : product.name,
      objective: product.objective,
      shortDescription: product.short_description,
      description: locale === "en" ? englishCategories[product.product_key]?.description || product.public_description : product.public_description,
      coverImageUrl: product.cover_image_url,
      featured: product.featured,
      modules: (modulesByProduct.get(product.id) || []).map((catalogModule) => {
        const content = localizedModule(catalogModule);
        return {
          id: catalogModule.id,
          code: catalogModule.module_code,
          slug: catalogModule.slug,
          ...content,
          standardScope: catalogModule.standard_scope,
          deliverables: catalogModule.deliverables,
          outOfScope: catalogModule.out_of_scope,
          durationLabel: catalogModule.duration_label,
          featured: catalogModule.featured,
          catalogVersion: catalogModule.catalog_version,
        };
      }),
    }))
    .filter((product) => product.modules.length > 0);
}
