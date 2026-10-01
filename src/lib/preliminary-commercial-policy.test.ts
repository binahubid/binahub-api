import { describe, expect, it } from "vitest";
import { automaticPreliminaryCommercialEligibility } from "./preliminary-commercial-policy";

describe("automaticPreliminaryCommercialEligibility", () => {
  it("allows an approved standard quote at the approval ceiling", () => {
    expect(automaticPreliminaryCommercialEligibility([{ basePrice: 25_000_000, quantity: 4 }])).toMatchObject({ eligible: true, total: 100_000_000 });
  });

  it("routes a higher quote to human approval", () => {
    expect(automaticPreliminaryCommercialEligibility([{ basePrice: 25_000_000, quantity: 5 }])).toMatchObject({ eligible: false });
  });

  it("does not auto-send a custom or missing price", () => {
    expect(automaticPreliminaryCommercialEligibility([{ basePrice: 0, quantity: 1 }])).toMatchObject({ eligible: false });
  });
});
