import { describe, expect, it } from "vitest";
import { isAutoSendableStandardModule } from "./standard-catalog-policy";

const standard = {
  id: "module-1", module_code: "SS-08", name: "Kepemimpinan Adaptif",
  standard_scope: "Scope resmi", deliverables: "Output resmi", duration_label: "1 hari", pricing_unit: "day", base_price: 25_000_000,
  minimum_quantity: 1, catalog_version: "signature-2026-ceo-v1",
  metadata: { commercialModel: "fixed_daily", requiresHumanCommercialReview: false },
};

describe("automatic standard catalog gate", () => {
  it("allows a fixed-price official Signature Solution", () => {
    expect(isAutoSendableStandardModule(standard)).toBe(true);
  });

  it("holds custom, tiered, and unpriced modules for human review", () => {
    expect(isAutoSendableStandardModule({ ...standard, module_code: "SS-18", pricing_unit: "custom", base_price: 0, metadata: { commercialModel: "custom_scope", requiresHumanCommercialReview: true } })).toBe(false);
    expect(isAutoSendableStandardModule({ ...standard, module_code: "SS-11", pricing_unit: "package", metadata: { commercialModel: "tiered_package" } })).toBe(false);
    expect(isAutoSendableStandardModule({ ...standard, base_price: 0 })).toBe(false);
  });

  it("does not auto-send an unrelated catalog generation", () => {
    expect(isAutoSendableStandardModule({ ...standard, catalog_version: "v1.0-public" })).toBe(false);
  });

  it("holds incomplete CEO detail for review", () => {
    expect(isAutoSendableStandardModule({ ...standard, deliverables: "" })).toBe(false);
    expect(isAutoSendableStandardModule({ ...standard, duration_label: null })).toBe(false);
  });
});
