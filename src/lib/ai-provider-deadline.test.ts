import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  now: 0,
  calls: [] as Array<{ baseURL: string; timeout: number; model: string }>,
  mode: "timeout" as "timeout" | "billing" | "invalid" | "fast",
  failFirstOpenRouterModel: false,
}));
vi.mock("openai", () => ({ default: class {
  chat;
  constructor(options: { baseURL: string; timeout: number }) {
    this.chat = { completions: { create: async ({ model }: { model: string }) => {
      mock.calls.push({ ...options, model });
      if (options.baseURL.includes("openrouter") && !(mock.failFirstOpenRouterModel && model === "synthetic/broken")) {
        return { choices: [{ message: { content: '{"ok":true}' } }] };
      }
      if (mock.mode === "timeout") {
        mock.now += options.timeout + 10; // include scheduling overhead
        throw new Error("Request timed out");
      }
      mock.now += 10;
      if (mock.mode === "billing") throw { status: 402 };
      if (mock.mode === "invalid") return { choices: [{ message: { content: "invalid JSON" } }] };
      throw { status: 503 };
    } } };
  }
} }));
import { callRoutedAI } from "./ai-provider";

const environment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  LAPAKVIP_API_KEY: "synthetic-lapak", CODECRAFT_API_KEY: "synthetic-codecraft", OPENROUTER_API_KEY: "synthetic-openrouter",
};
const messages = [{ role: "user" as const, content: "Synthetic fallback test" }];
beforeEach(() => {
  mock.now = 0; mock.calls.length = 0; mock.mode = "timeout"; mock.failFirstOpenRouterModel = false;
  vi.spyOn(Date, "now").mockImplementation(() => mock.now);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("fallback provider deadline isolation", () => {
  it.each(["general", "reasoning", "vision"] as const)("reserves time for OpenRouter after slow primary/secondary models (%s)", async (purpose) => {
    const result = await callRoutedAI({ environment, messages, purpose,
      routingPolicy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "codecraft", "openrouter"] },
    });
    expect(result.provider).toBe("openrouter");
    expect(mock.calls.map((call) => new URL(call.baseURL).hostname)).toEqual([
      "router.lapakvip.com", "codecraftapi.com", "openrouter.ai",
    ]);
    expect(mock.calls.at(-1)?.timeout).toBeGreaterThan(18_000);
    expect(mock.now).toBeLessThan(55_000);
  });
  it.each([10_000, 25_000])("reaches OpenRouter within a short %i ms budget", async (totalTimeoutMs) => {
    expect((await callRoutedAI({ environment, messages,
      routingPolicy: { primaryProvider: "codecraft", enabledProviders: ["lapakvip", "codecraft", "openrouter"] },
      budget: { perAttemptTimeoutMs: 10_000, totalTimeoutMs },
    })).provider).toBe("openrouter");
    expect(mock.calls.at(-1)?.timeout).toBeGreaterThan(3_000);
    expect(mock.now).toBeLessThan(totalTimeoutMs);
  });
  it.each(["billing", "invalid", "fast"] as const)("retains fallback after %s failures", async (mode) => {
    mock.mode = mode;
    const result = await callRoutedAI({ environment, messages, validateContent: (content) => { JSON.parse(content); },
      routingPolicy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "codecraft", "openrouter"] },
    });
    expect(result.provider).toBe("openrouter");
    expect(mock.calls.filter((call) => call.baseURL.includes("lapakvip"))).toHaveLength(mode === "billing" ? 1 : 2);
  });
  it("does not enable OpenRouter implicitly when its switch is OFF", async () => {
    await expect(callRoutedAI({ environment, messages,
      routingPolicy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "codecraft"] },
    })).rejects.toThrow("Seluruh AI provider gagal");
    expect(mock.calls.some((call) => call.baseURL.includes("openrouter"))).toBe(false);
  });
  it("does not reserve time for providers without credentials", async () => {
    expect((await callRoutedAI({ environment: { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic" }, messages,
      routingPolicy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "openrouter"] },
    })).provider).toBe("openrouter");
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0].timeout).toBe(25_000);
  });
  it.each(["timeout", "fast", "invalid"] as const)("can recover from an OpenRouter model %s with a second model", async (mode) => {
    mock.mode = mode; mock.failFirstOpenRouterModel = true;
    const result = await callRoutedAI({ environment: { NODE_ENV: "test", OPENROUTER_API_KEY: "synthetic",
      OPENROUTER_MODEL: "synthetic/broken" }, messages,
      validateContent: (content) => { JSON.parse(content); },
      budget: { totalTimeoutMs: 10_000 },
    });
    expect(result.provider).toBe("openrouter");
    expect(result.model).toBe("nvidia/nemotron-3.5-super-vl:free");
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls.at(-1)?.timeout).toBeGreaterThan(4_000);
  });
});
