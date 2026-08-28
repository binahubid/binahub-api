import { describe, expect, it } from "vitest";
import { buildPublicCatalog } from "./public-catalog";

describe("buildPublicCatalog", () => {
  it("groups modules by product and normalizes numeric prices", () => {
    const result = buildPublicCatalog(
      [
        { id: "p1", product_key: "binainsight", name: "BinaInsight", objective: "Diagnosis" },
        { id: "p2", product_key: "empty", name: "Empty", objective: null },
      ],
      [{
        id: "m1",
        product_id: "p1",
        module_code: "BI-PUBLIC",
        name: "Public Assessment",
        description: "Free assessment",
        standard_scope: "Individual report",
        pricing_unit: "per respondent",
        base_price: "0",
        currency: "IDR",
        catalog_version: "v1",
      }],
    );

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("binainsight");
    expect(result[0].modules[0].basePrice).toBe(0);
  });
});
