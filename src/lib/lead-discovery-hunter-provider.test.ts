import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeadDiscoveryConfig } from "./lead-discovery-config";
import {
  enrichHunterCandidate,
  leadDiscoveryHunterProviderInternals,
  searchHunterCandidates,
} from "./lead-discovery-hunter-provider";
import type { DiscoveryCandidate, LeadDiscoveryIcp } from "./lead-discovery-scoring";

afterEach(() => vi.unstubAllEnvs());

const config = {
  provider: "hunter",
  enrichWorkEmails: true,
  hunterAiQueryEnabled: false,
  maximumCandidatesPerRun: 10,
  requestTimeoutMs: 20_000,
} as LeadDiscoveryConfig;

const icp = {
  country: "Indonesia",
  minimumCompanySize: 20,
  maximumCompanySize: null,
  decisionMakerRoles: ["HR Director", "CEO"],
  championRoles: ["L&D Manager"],
} as LeadDiscoveryIcp;

const companyCandidate: DiscoveryCandidate = {
  candidateKind: "company",
  providerPersonId: "company:contoh.co.id",
  providerOrganizationId: "contoh.co.id",
  fullName: "Decision maker belum dipilih",
  roleTitle: null,
  company: "PT Contoh",
  companyDomain: "contoh.co.id",
  industry: "Manufacturing",
  location: "Jakarta, Indonesia",
  employeeCount: null,
  employeeRange: "51-200",
  workEmail: null,
  emailStatus: null,
  linkedinUrl: null,
  sourceUrl: "https://contoh.co.id",
  organizationDescription: "Learning transformation",
  organizationKeywords: ["upskilling"],
};

describe("Hunter provider", () => {
  it("uses free Discover with header authentication and conservative ICP buckets", async () => {
    vi.stubEnv("HUNTER_API_KEY", "hunter-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v2/discover");
      expect(url.searchParams.has("api_key")).toBe(false);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer hunter-test-key");
      const body = JSON.parse(String(init?.body));
      expect(body.headquarters_location.include).toEqual([{ country: "ID" }]);
      expect(body.headcount).not.toContain("11-50");
      expect(body.headcount).toContain("51-200");
      expect(body.limit).toBeUndefined();
      expect(body.query).toBeUndefined();
      return new Response(JSON.stringify({ data: [{
        domain: "contoh.co.id",
        organization: "PT Contoh",
        emails_count: { personal: 3, generic: 1, total: 4 },
        industry: "Manufacturing",
        country: "Indonesia",
        city: "Jakarta",
        headcount: "51-200",
        keywords: ["upskilling"],
      }], meta: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const candidates = await searchHunterCandidates(config, icp, fetchMock as unknown as typeof fetch);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ candidateKind: "company", companyDomain: "contoh.co.id", employeeRange: "51-200" });
  });

  it("enriches only a matching verified work contact and discards phone data", async () => {
    vi.stubEnv("HUNTER_API_KEY", "hunter-test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v2/domain-search");
      expect(url.searchParams.get("limit")).toBe("10");
      expect(url.searchParams.has("api_key")).toBe(false);
      return new Response(JSON.stringify({ data: { emails: [{
        id: 42,
        value: "rina@contoh.co.id",
        first_name: "Rina",
        last_name: "Contoh",
        position: "HR Director",
        decision_maker: true,
        linkedin: "https://linkedin.com/in/rina",
        phone_number: "+628123456",
        verification: { status: "valid" },
      }] }, meta: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const enriched = await enrichHunterCandidate(companyCandidate, config, icp, fetchMock as unknown as typeof fetch);
    expect(enriched).toMatchObject({
      candidateKind: "person",
      fullName: "Rina Contoh",
      roleTitle: "HR Director",
      workEmail: "rina@contoh.co.id",
      emailStatus: "verified",
    });
    expect(JSON.stringify(enriched)).not.toContain("+628123456");
  });

  it("keeps a company in review when no matching role is available", async () => {
    vi.stubEnv("HUNTER_API_KEY", "hunter-test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { emails: [{
      value: "sales@contoh.co.id",
      first_name: "Sales",
      last_name: "Person",
      position: "Sales Executive",
      verification: { status: "valid" },
    }] }, meta: {} }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await enrichHunterCandidate(companyCandidate, config, icp, fetchMock as unknown as typeof fetch);
    expect(result.candidateKind).toBe("company");
  });

  it("normalizes Hunter records without retaining phone fields", () => {
    const normalized = leadDiscoveryHunterProviderInternals.normalizeHunterEmail({
      value: "rina@contoh.co.id",
      first_name: "Rina",
      last_name: "Contoh",
      position: "CEO",
      phone_number: "+628123456",
      verification: { status: "valid" },
    }, companyCandidate);
    expect(JSON.stringify(normalized)).not.toContain("+628123456");
  });
});
