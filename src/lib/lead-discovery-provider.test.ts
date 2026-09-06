import { afterEach, describe, expect, it, vi } from "vitest";
import type { LeadDiscoveryConfig } from "./lead-discovery-config";
import type { LeadDiscoveryIcp } from "./lead-discovery-scoring";
import { leadDiscoveryProviderInternals, searchApolloCandidates } from "./lead-discovery-provider";

afterEach(() => vi.unstubAllEnvs());

describe("Apollo provider normalization", () => {
  it("keeps only business discovery fields and omits phone data", () => {
    const candidate = leadDiscoveryProviderInternals.normalizeApolloPerson({
      id: "p-1",
      name: "Rina Contoh",
      title: "HR Director",
      email: "RINA@CONTOH.CO.ID",
      phone_numbers: [{ raw_number: "+628123" }],
      city: "Jakarta",
      country: "Indonesia",
      organization: {
        id: "o-1",
        name: "PT Contoh",
        primary_domain: "contoh.co.id",
        estimated_num_employees: 120,
      },
    });
    expect(candidate?.workEmail).toBe("rina@contoh.co.id");
    expect(candidate?.location).toBe("Jakarta, Indonesia");
    expect(JSON.stringify(candidate)).not.toContain("+628123");
  });

  it("uses company location as the B2B ICP location", () => {
    const candidate = leadDiscoveryProviderInternals.normalizeApolloPerson({
      id: "p-2",
      name: "Rina Contoh",
      city: "Singapore",
      country: "Singapore",
      organization: {
        id: "o-2",
        name: "PT Contoh Indonesia",
        city: "Jakarta",
        country: "Indonesia",
      },
    });
    expect(candidate?.location).toBe("Jakarta, Indonesia");
  });

  it("searches Indonesian organizations without requesting personal contact data", async () => {
    vi.stubEnv("APOLLO_API_KEY", "test-key");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/v1/mixed_people/api_search");
      expect(url.searchParams.getAll("organization_locations[]")).toEqual(["Indonesia"]);
      expect(url.searchParams.has("person_locations[]")).toBe(false);
      expect(url.searchParams.has("reveal_personal_emails")).toBe(false);
      expect(url.searchParams.has("reveal_phone_number")).toBe(false);
      return new Response(JSON.stringify({ people: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const config = {
      provider: "apollo",
      maximumCandidatesPerRun: 10,
      requestTimeoutMs: 20_000,
    } as LeadDiscoveryConfig;
    const icp = {
      country: "Indonesia",
      minimumCompanySize: 20,
      maximumCompanySize: null,
      decisionMakerRoles: ["CEO"],
      championRoles: ["HRBP"],
    } as LeadDiscoveryIcp;

    await searchApolloCandidates(config, icp, fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
