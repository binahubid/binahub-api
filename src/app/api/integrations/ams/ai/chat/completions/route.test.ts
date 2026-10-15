import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/lib/ai-provider", () => ({ callRoutedAI: mock.call }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: vi.fn() }));
import { POST } from "./route";
const secret = "synthetic-integration-secret";
const body = { model: "binahub-managed", messages: [{ role: "user", content: "Synthetic request" }], response_format: { type: "json_object" } };
function request(payload: unknown = body, signed = true) {
  const raw = JSON.stringify(payload), timestamp = String(Date.now());
  return new NextRequest("https://api.example.com/api/integrations/ams/ai/chat/completions", { method: "POST", body: raw,
    headers: { "x-binahub-timestamp": timestamp, "x-binahub-signature": signed ? createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex") : "invalid" } });
}
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AMS_INTEGRATION_SECRET", secret); mock.call.mockResolvedValue({ content: '{"ok":true}', model: "example", provider: "codecraft", usage: null }); });
afterEach(() => vi.unstubAllEnvs());
describe("signed AMS managed AI endpoint", () => {
  it("denies unsigned, tampered and invalid override requests before calling AI", async () => {
    expect((await POST(request(body, false))).status).toBe(401);
    expect((await POST(request({ ...body, provider: "lapakvip" }))).status).toBe(400);
    expect((await POST(request({ ...body, max_tokens: 100000 }))).status).toBe(400);
    expect(mock.call).not.toHaveBeenCalled();
  });
  it("uses central routing, validates JSON, and returns an SDK-compatible completion", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect((await response.json()).choices[0].message.content).toBe('{"ok":true}');
    const input = mock.call.mock.calls[0][0];
    expect(input).not.toHaveProperty("routingPolicy"); expect(input).not.toHaveProperty("environment");
    expect(() => input.validateContent("not JSON")).toThrow();
  });
  it("never returns upstream error details to AMS", async () => {
    mock.call.mockRejectedValue(new Error("request contains private CV text and key"));
    const response = await POST(request()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private CV");
  });
});
