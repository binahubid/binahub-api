export type PublicCatalogModuleRow = {
  id: string;
  product_id: string;
  module_code: string;
  name: string;
  description: string | null;
  standard_scope: string | null;
  pricing_unit: string;
  base_price: number | string;
  currency: string;
  catalog_version: string;
};

export type PublicCatalogProductRow = {
  id: string;
  product_key: string;
  name: string;
  objective: string | null;
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
      name: product.name,
      objective: product.objective,
      modules: (modulesByProduct.get(product.id) || []).map((catalogModule) => ({
        id: catalogModule.id,
        code: catalogModule.module_code,
        name: catalogModule.name,
        description: catalogModule.description,
        standardScope: catalogModule.standard_scope,
        pricingUnit: catalogModule.pricing_unit,
        basePrice: Number(catalogModule.base_price || 0),
        currency: catalogModule.currency,
        catalogVersion: catalogModule.catalog_version,
      })),
    }))
    .filter((product) => product.modules.length > 0);
}
