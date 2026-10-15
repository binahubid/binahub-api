import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./supabase", () => ({ createServerSupabase: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) }) }));
import { loadAIRoutingPolicy, readAIProviderSettings } from "./ai-provider-settings";
import { aiRoutingPolicySchema, defaultRoutingPolicy } from "./ai-routing-policy";
beforeEach(() => vi.resetAllMocks());
describe("persisted AI provider settings", () => {
  it("reads new settings each time, without a stale process cache", async () => {
    mocks.read.mockResolvedValueOnce({ data: { primary_provider: "codecraft", enabled_providers: ["codecraft"], version: 1 } })
      .mockResolvedValueOnce({ data: { primary_provider: "openrouter", enabled_providers: ["openrouter"], version: 2 } });
    expect((await loadAIRoutingPolicy())?.primaryProvider).toBe("codecraft");
    expect((await loadAIRoutingPolicy())?.primaryProvider).toBe("openrouter");
  });
  it("handles staged migration rollout but fails closed for database failures/corruption", async () => {
    mocks.read.mockResolvedValue({ error: { code: "42P01" } });
    expect(await readAIProviderSettings()).toMatchObject({ policy: null, setupRequired: true });
    mocks.read.mockResolvedValue({ error: { code: "XX000", message: "private DB error" } });
    await expect(readAIProviderSettings()).rejects.toThrow("AI_SETTINGS_UNAVAILABLE");
    mocks.read.mockResolvedValue({ data: { primary_provider: "codecraft", enabled_providers: ["lapakvip"] } });
    await expect(loadAIRoutingPolicy()).rejects.toThrow();
  });
  it("rejects conflicting/duplicate selections and keeps legacy defaults until saved", () => {
    expect(aiRoutingPolicySchema.safeParse({ primaryProvider: "codecraft", enabledProviders: ["lapakvip"] }).success).toBe(false);
    expect(aiRoutingPolicySchema.safeParse({ primaryProvider: "codecraft", enabledProviders: ["codecraft", "codecraft"] }).success).toBe(false);
    expect(defaultRoutingPolicy({ NODE_ENV: "test", LAPAKVIP_API_KEY: "test", CODECRAFT_API_KEY: "test", OPENROUTER_API_KEY: "test" }))
      .toEqual({ primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "openrouter"] });
  });
});
