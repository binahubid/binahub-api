import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/ai-provider-settings", async (original) => ({ ...await original<typeof import("@/lib/ai-provider-settings")>(), readAIProviderSettings: mocks.read }));
import { GET, POST } from "./route";
const actor = "00000000-0000-4000-8000-000000000001";
const policy = { primaryProvider: "codecraft", enabledProviders: ["codecraft"] };
const request = (body = { policy, version: 0 }) => new NextRequest("https://api.example.com/api/admin/ai-settings", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("CODECRAFT_API_KEY", "secret-test-key"); vi.stubEnv("LAPAKVIP_API_KEY", ""); vi.stubEnv("OPENROUTER_API_KEY", "");
  mocks.auth.mockResolvedValue({ userId: actor, email: "admin@example.com" });
  mocks.read.mockResolvedValue({ policy: null, version: 0, updatedAt: null, setupRequired: false });
  mocks.rpc.mockResolvedValue({ data: { version: 1, updated_at: "2026-10-15T00:00:00Z" }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe("admin AI settings API", () => {
  it("authenticates reads and saves before privileged calls", async () => {
    mocks.auth.mockResolvedValue({ error: "Denied", status: 403 });
    expect((await GET(request())).status).toBe(403); expect((await POST(request())).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns safe model metadata but never credentials", async () => {
    const response = await GET(request());
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text(); expect(text).not.toContain("secret-test-key"); expect(text).not.toContain("apiKey");
    expect(JSON.parse(text).providers.find((item: { id: string }) => item.id === "codecraft").configured).toBe(true);
  });
  it("validates credentials/allowlist and uses the authenticated actor", async () => {
    expect((await POST(request({ policy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip"] }, version: 0 }))).status).toBe(400);
    expect((await POST(request({ policy, version: 0, actor: "spoofed" } as never))).status).toBe(400);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("save_ai_provider_settings", { p_primary: "codecraft", p_enabled: ["codecraft"], p_version: 0, p_actor: actor });
  });
  it("reports version conflicts and generic failures without leaking DB details", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "AI_SETTINGS_CONFLICT" } });
    expect((await POST(request())).status).toBe(409);
    mocks.rpc.mockResolvedValue({ error: { message: "internal password secret", code: "XX000" } });
    expect(await (await POST(request())).text()).not.toContain("internal password secret");
  });
});
