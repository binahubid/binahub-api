import { describe, expect, it } from "vitest";
import { isAllowedWorkEmail, scoreLeadDiscoveryCandidate, type DiscoveryCandidate, type LeadDiscoveryIcp } from "./lead-discovery-scoring";

const icp: LeadDiscoveryIcp = {
  industries: ["general"],
  excludedIndustries: ["tobacco"],
  minimumCompanySize: 20,
  maximumCompanySize: null,
  country: "Indonesia",
  priorityLocations: ["Jakarta"],
  decisionMakerRoles: ["HR Director", "CEO"],
  championRoles: ["L&D Manager"],
  positiveSignals: ["transformation", "upskilling"],
  otherExclusions: [],
  ruleVersion: "v1",
};

const candidate: DiscoveryCandidate = {
  candidateKind: "person",
  providerPersonId: "person-1",
  providerOrganizationId: "org-1",
  fullName: "Rina Contoh",
  roleTitle: "HR Director",
  company: "PT Contoh",
  companyDomain: "contoh.co.id",
  industry: "Manufacturing",
  location: "Jakarta, Indonesia",
  employeeCount: 150,
  employeeRange: null,
  workEmail: "rina@contoh.co.id",
  emailStatus: "verified",
  linkedinUrl: null,
  sourceUrl: "https://contoh.co.id",
  organizationDescription: "Business transformation and upskilling",
  organizationKeywords: ["transformation"],
};

describe("lead discovery scoring", () => {
  it("scores a matching decision maker from an eligible company", () => {
    const result = scoreLeadDiscoveryCandidate(candidate, icp, 50);
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.matchReasons).toContain("Jabatan sesuai decision maker ICP.");
  });

  it("hard-excludes a prohibited industry", () => {
    const result = scoreLeadDiscoveryCandidate({ ...candidate, industry: "Tobacco" }, icp, 50);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReasons).toContain("Industri termasuk kriteria pengecualian.");
  });

  it("lowers confidence when provider evidence is incomplete", () => {
    const result = scoreLeadDiscoveryCandidate({
      ...candidate,
      industry: null,
      location: null,
      employeeCount: null,
      organizationDescription: null,
      organizationKeywords: [],
    }, icp, 50);
    expect(result.confidence).toBeLessThan(0.6);
    expect(result.eligible).toBe(false);
    expect(result.exclusionReasons).toContain("Industri belum tersedia.");
  });

  it("accepts company email and rejects personal email", () => {
    expect(isAllowedWorkEmail("rina@contoh.co.id", "contoh.co.id")).toBe(true);
    expect(isAllowedWorkEmail("rina@gmail.com", "contoh.co.id")).toBe(false);
    expect(isAllowedWorkEmail("rina@vendor.co.id", "contoh.co.id")).toBe(false);
    expect(isAllowedWorkEmail("rina@contoh.co.id", null)).toBe(false);
  });

  it("accepts a provider headcount bucket only when the whole bucket fits the ICP", () => {
    const matching = scoreLeadDiscoveryCandidate({ ...candidate, employeeCount: null, employeeRange: "51-200" }, icp, 50);
    const uncertain = scoreLeadDiscoveryCandidate({ ...candidate, employeeCount: null, employeeRange: "11-50" }, icp, 50);
    expect(matching.eligible).toBe(true);
    expect(uncertain.eligible).toBe(false);
  });
});
