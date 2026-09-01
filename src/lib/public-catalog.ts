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
  pricing_unit: string;
  base_price: number | string;
  minimum_quantity: number | string;
  currency: string;
  duration_label: string | null;
  featured: boolean;
  display_order: number;
  catalog_version: string;
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
) {
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
      name: product.name,
      objective: product.objective,
      shortDescription: product.short_description,
      description: product.public_description,
      coverImageUrl: product.cover_image_url,
      featured: product.featured,
      modules: (modulesByProduct.get(product.id) || []).map((catalogModule) => ({
        id: catalogModule.id,
        code: catalogModule.module_code,
        slug: catalogModule.slug,
        name: catalogModule.name,
        description: catalogModule.description,
        standardScope: catalogModule.standard_scope,
        deliverables: catalogModule.deliverables,
        outOfScope: catalogModule.out_of_scope,
        pricingUnit: catalogModule.pricing_unit,
        basePrice: Number(catalogModule.base_price || 0),
        minimumQuantity: Number(catalogModule.minimum_quantity || 1),
        currency: catalogModule.currency,
        durationLabel: catalogModule.duration_label,
        featured: catalogModule.featured,
        catalogVersion: catalogModule.catalog_version,
      })),
    }))
    .filter((product) => product.modules.length > 0);
}
