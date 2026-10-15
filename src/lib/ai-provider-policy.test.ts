import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ load: vi.fn(), complete: vi.fn(), clients: [] as string[] }));
vi.mock("./ai-provider-settings", () => ({ loadAIRoutingPolicy: mock.load }));
vi.mock("openai", () => ({ default: class {
  chat = { completions: { create: mock.complete } };
  constructor(options: { baseURL: string }) { mock.clients.push(options.baseURL); }
} }));
import { callRoutedAI } from "./ai-provider";
beforeEach(() => {
  vi.resetAllMocks(); mock.clients.length = 0;
  vi.stubEnv("LAPAKVIP_API_KEY", "test"); vi.stubEnv("CODECRAFT_API_KEY", "test"); vi.stubEnv("OPENROUTER_API_KEY", "test");
  mock.complete.mockResolvedValue({ choices: [{ message: { content: "Synthetic response" } }] });
});
afterEach(() => vi.unstubAllEnvs());
describe("production calls honor the persisted provider policy", () => {
  it("changes primary for the next request and never calls a disabled provider", async () => {
    mock.load.mockResolvedValueOnce({ primaryProvider: "codecraft", enabledProviders: ["codecraft"] })
      .mockResolvedValueOnce({ primaryProvider: "openrouter", enabledProviders: ["openrouter"] });
    const input = { messages: [{ role: "user" as const, content: "Synthetic only" }] };
    expect((await callRoutedAI(input)).provider).toBe("codecraft");
    expect((await callRoutedAI(input)).provider).toBe("openrouter");
    expect(mock.clients).toHaveLength(2); expect(mock.clients.some((url) => url.includes("lapakvip"))).toBe(false);
  });
  it("does not bypass OFF switches after failure or database unavailability", async () => {
    mock.load.mockResolvedValue({ primaryProvider: "openrouter", enabledProviders: ["openrouter"] });
    mock.complete.mockRejectedValue({ status: 402 });
    await expect(callRoutedAI({ messages: [{ role: "user", content: "Synthetic only" }] })).rejects.toThrow("Seluruh AI provider gagal");
    expect(mock.clients).toHaveLength(1);
    mock.load.mockRejectedValue(new Error("AI_SETTINGS_UNAVAILABLE"));
    await expect(callRoutedAI({ messages: [{ role: "user", content: "Synthetic only" }] })).rejects.toThrow("AI_SETTINGS_UNAVAILABLE");
    expect(mock.clients).toHaveLength(1);
  });
});
