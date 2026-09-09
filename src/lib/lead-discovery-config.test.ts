import { describe, expect, it } from "vitest";
import { getLeadDiscoveryConfig, publicLeadDiscoveryConfig } from "./lead-discovery-config";

describe("lead discovery config", () => {
  it("fails closed when no environment is configured", () => {
    const config = getLeadDiscoveryConfig({});
    expect(config.enabled).toBe(false);
    expect(config.providerCallsEnabled).toBe(false);
    expect(config.dryRun).toBe(true);
    expect(config.stagingEnabled).toBe(false);
    expect(config.blockers.length).toBeGreaterThan(0);
  });

  it("exposes readiness flags without exposing IDs or secrets", () => {
    const config = getLeadDiscoveryConfig({
      LEAD_AGENT_ENABLED: "true",
      LEAD_AGENT_PROVIDER_CALLS_ENABLED: "true",
      LEAD_AGENT_DRY_RUN: "true",
      LEAD_AGENT_SOURCE_ID: "11111111-1111-4111-8111-111111111111",
      APOLLO_API_KEY: "top-secret",
    });
    const visible = publicLeadDiscoveryConfig(config);
    expect(visible.apiKeyConfigured).toBe(true);
    expect(visible.sourceConfigured).toBe(true);
    expect(JSON.stringify(visible)).not.toContain("top-secret");
    expect(JSON.stringify(visible)).not.toContain("11111111-1111-4111-8111-111111111111");
  });

  it("selects Hunter credentials and keeps enrichment credit-limited", () => {
    const config = getLeadDiscoveryConfig({
      LEAD_AGENT_PROVIDER: "hunter",
      LEAD_AGENT_ENABLED: "true",
      LEAD_AGENT_PROVIDER_CALLS_ENABLED: "true",
      LEAD_AGENT_DRY_RUN: "true",
      LEAD_AGENT_SOURCE_KEY: "ai_lead_discovery_hunter",
      HUNTER_API_KEY: "hunter-secret",
      LEAD_AGENT_HUNTER_ENRICH_WORK_EMAILS: "true",
      LEAD_AGENT_HUNTER_AI_QUERY_ENABLED: "true",
      LEAD_AGENT_HUNTER_MAX_DOMAIN_SEARCHES_PER_RUN: "99",
    });
    expect(config.provider).toBe("hunter");
    expect(config.apiKeyConfigured).toBe(true);
    expect(config.enrichWorkEmails).toBe(true);
    expect(config.hunterAiQueryEnabled).toBe(true);
    expect(config.maximumHunterEnrichmentsPerRun).toBe(10);
    expect(config.blockers).toEqual([]);
    expect(JSON.stringify(publicLeadDiscoveryConfig(config))).not.toContain("hunter-secret");
  });

  it("accepts CodeCraft as the AI scoring credential with OpenRouter optional", () => {
    const config = getLeadDiscoveryConfig({
      LEAD_AGENT_PROVIDER: "apollo",
      LEAD_AGENT_ENABLED: "true",
      LEAD_AGENT_PROVIDER_CALLS_ENABLED: "true",
      LEAD_AGENT_DRY_RUN: "true",
      LEAD_AGENT_SOURCE_KEY: "ai_lead_discovery_apollo",
      LEAD_AGENT_AI_SCORING_ENABLED: "true",
      APOLLO_API_KEY: "apollo-secret",
      CODECRAFT_API_KEY: "codecraft-secret",
    });
    expect(config.blockers).toEqual([]);
    expect(JSON.stringify(publicLeadDiscoveryConfig(config))).not.toContain("codecraft-secret");
  });
});
