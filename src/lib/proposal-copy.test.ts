import { describe, expect, it } from "vitest";
import { clientProposalCopy, clientProposalText } from "./proposal-copy";

describe("client-facing proposal copy", () => {
  it.each([
    ["Proposal Standar", "Proposal"], ["Proposal Custom", "Proposal"],
    ["Standard Solution Proposal", "Proposal"], ["Custom Proposal", "Proposal"],
    ["Harga dasar katalog: Rp 25.000.000", "Investasi program: Rp 25.000.000"],
    ["Standard catalog base price: IDR 25,000,000", "Program investment: IDR 25,000,000"],
    ["Cakupan standar katalog", "Cakupan program"], ["Standard catalog scope", "Program scope"],
    ["Durasi katalog: 1 hari", "Durasi program: 1 hari"],
  ])("rephrases %s without changing amounts", (input, output) => {
    expect(clientProposalText(input)).toBe(output);
  });
  it("cleans existing narrative without mutating source or commercial rules", () => {
    const source = {
      proposalType: "standard", rulesVersion: "automatic-standard-v2", isSimulation: false,
      subject: "Proposal Standar", investmentNote: "Harga dasar katalog: Rp 25.000.000",
      scope: ["Cakupan standar katalog"], selectedSolutions: [{ code: "SS-12", name: "Solusi", focus: "Durasi katalog: 1 hari" }],
      commercialSnapshot: { items: [{ name: "Solusi", quantity: 2, basePrice: 25_000_000, lineTotal: 50_000_000 }], totalBeforeTax: 50_000_000, validityDays: 14 },
    };
    const clean = clientProposalCopy(source);
    expect(clean.subject).toBe("Proposal");
    expect(clean.scope).toEqual(["Cakupan program"]);
    expect(clean.selectedSolutions[0].focus).toBe("Durasi program: 1 hari");
    expect(clean.proposalType).toBe(source.proposalType);
    expect(clean.rulesVersion).toBe(source.rulesVersion);
    expect(clean.commercialSnapshot).toEqual(source.commercialSnapshot);
    expect(source.subject).toBe("Proposal Standar");
  });
  it("preserves legitimate training content and draft warnings", () => {
    expect(clientProposalText("Pelatihan Standard Operating Procedure")).toBe("Pelatihan Standard Operating Procedure");
    expect(clientProposalText("SIMULASI - bukan penawaran resmi")).toBe("SIMULASI - bukan penawaran resmi");
  });
});
