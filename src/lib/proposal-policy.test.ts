import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOCK_PROPOSAL_RULES,
  addBusinessDays,
  calculateProposalCommercials,
  evaluateRequiredProposalData,
  evaluateProposalGate,
  normalizeProposalRules,
  proposalReviewSlaBusinessDays,
  type ProposalModuleInput,
} from "./proposal-policy";

const readyModule: ProposalModuleInput = {
  id: "00000000-0000-4000-8000-000000000001",
  moduleCode: "REAL-01",
  productKey: "binaplay",
  name: "Ready module",
  standardScope: "Scope",
  pricingUnit: "per sesi",
  basePrice: 50_000_000,
  quantity: 2,
  readinessStatus: "ready",
  isMock: false,
  catalogVersion: "v1",
};

describe("proposal policy", () => {
  it("calculates totals from module prices instead of product names", () => {
    expect(calculateProposalCommercials([readyModule], 10)).toMatchObject({
      subtotal: 100_000_000,
      discountAmount: 10_000_000,
      totalBeforeTax: 90_000_000,
    });
  });

  it("blocks mock and non-ready modules", () => {
    const gate = evaluateProposalGate({
      rules: DEFAULT_MOCK_PROPOSAL_RULES,
      modules: [{ ...readyModule, isMock: true, readinessStatus: "design" }],
      totalBeforeTax: 50_000_000,
      discountPercent: 0,
      scopeType: "standard",
      aiConfidence: 0.9,
      riskFlags: [],
      requiredDataComplete: true,
    });
    expect(gate.status).toBe("pending_approval");
    expect(gate.reasons.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "MOCK_RULES",
      "MOCK_MODULE",
      "MODULE_NOT_READY",
    ]));
  });

  it("routes deals below the minimum transaction to human review", () => {
    const rules = normalizeProposalRules({
      version: "v1",
      is_mock: false,
      rules: { minimumTransaction: 15_000_000, humanGate: { allowStandardAutoSend: true } },
    });
    const gate = evaluateProposalGate({
      rules,
      modules: [{ ...readyModule, basePrice: 10_000_000, quantity: 1 }],
      totalBeforeTax: 10_000_000,
      discountPercent: 0,
      scopeType: "standard",
      aiConfidence: 0.9,
      riskFlags: [],
      requiredDataComplete: true,
    });
    expect(gate.reasons.map((reason) => reason.code)).toContain("BELOW_MINIMUM_TRANSACTION");
    expect(gate.canAutoSend).toBe(false);
  });

  it("allows a real standard proposal when active rules explicitly permit it", () => {
    const rules = normalizeProposalRules({
      version: "v1",
      is_mock: false,
      rules: { humanGate: { allowStandardAutoSend: true } },
    });
    const gate = evaluateProposalGate({
      rules,
      modules: [readyModule],
      totalBeforeTax: 100_000_000,
      discountPercent: 0,
      scopeType: "standard",
      aiConfidence: 0.9,
      riskFlags: [],
      requiredDataComplete: true,
    });
    expect(gate).toMatchObject({ status: "clear", canAutoSend: true, reasons: [] });
  });

  it("lists every missing Business Rules proposal field without guessing", () => {
    const result = evaluateRequiredProposalData({
      form: {
        company: "PT Contoh",
        challenge: "Kinerja lintas fungsi belum konsisten.",
        target: "Meningkatkan eksekusi strategi.",
      },
      modules: [readyModule],
      provided: { timeline: "Q4 2026" },
    });

    expect(result.complete).toBe(false);
    expect(result.data.scope).toBe("Scope");
    expect(result.missingFields).toEqual(expect.arrayContaining([
      "participantEstimate",
      "targetAudience",
      "decisionMakerOrSponsor",
      "budgetIndication",
      "deliveryLocationOrMode",
      "expectedOutcome",
      "nextStep",
    ]));
  });

  it("uses business-day SLAs for standard, commercial approval, and custom review", () => {
    const friday = new Date("2026-08-28T03:00:00.000Z");
    expect(addBusinessDays(friday, 1).toISOString()).toBe("2026-08-31T03:00:00.000Z");
    expect(proposalReviewSlaBusinessDays([])).toBe(1);
    expect(proposalReviewSlaBusinessDays([{ code: "HIGH_DEAL_VALUE", message: "", severity: "blocking" }])).toBe(2);
    expect(proposalReviewSlaBusinessDays([{ code: "CUSTOM_SCOPE", message: "", severity: "blocking" }])).toBe(3);
  });
});
