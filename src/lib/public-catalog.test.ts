import { describe, expect, it } from "vitest";
import { buildPublicCatalog } from "./public-catalog";

describe("buildPublicCatalog", () => {
  it("groups modules by product and normalizes numeric prices", () => {
    const result = buildPublicCatalog(
      [
        { id: "p1", product_key: "binainsight", slug: "binainsight", name: "BinaInsight", objective: "Diagnosis", short_description: "Diagnosis", public_description: "Description", cover_image_url: null, featured: true, display_order: 0 },
        { id: "p2", product_key: "empty", slug: "empty", name: "Empty", objective: null, short_description: null, public_description: null, cover_image_url: null, featured: false, display_order: 1 },
      ],
      [{
        id: "m1",
        product_id: "p1",
        module_code: "BI-PUBLIC",
        slug: "bi-public",
        name: "Public Assessment",
        description: "Free assessment",
        standard_scope: "Individual report",
        deliverables: "PDF report",
        out_of_scope: null,
        pricing_unit: "per respondent",
        base_price: "0",
        minimum_quantity: "1",
        currency: "IDR",
        duration_label: "15 minutes",
        featured: true,
        display_order: 0,
        catalog_version: "v1",
      }],
    );

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("binainsight");
    expect(result[0].modules[0].basePrice).toBe(0);
  });
});
