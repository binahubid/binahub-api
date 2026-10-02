import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { buildAIProviderAttempts, callRoutedAI } from "./ai-provider";

describe("AI provider routing", () => {
  it("uses LapakVIP first and skips the broken CodeCraft account when configured", () => {
    const attempts = buildAIProviderAttempts({
      LAPAKVIP_API_KEY: "lapakvip-test-key",
      LAPAKVIP_MODEL: "DeepSeek V4.1 Flash",
      LAPAKVIP_FALLBACK_MODELS: "lv/deepseek-v4.1-flash,lv/grok-4.6",
      CODECRAFT_API_KEY: "codecraft-test-key",
      OPENROUTER_API_KEY: "openrouter-test-key",
      OPENROUTER_MODEL: "openrouter/fallback",
    } as unknown as NodeJS.ProcessEnv);

    expect(attempts.map(({ provider, model }) => `${provider}:${model}`)).toEqual([
      "lapakvip:lv/deepseek-v4.1-flash",
      "lapakvip:lv/grok-4.6",
      "openrouter:openrouter/fallback",
    ]);
  });

  it("keeps vision requests on vision-capable LapakVIP models", () => {
    const attempts = buildAIProviderAttempts({
      LAPAKVIP_API_KEY: "lapakvip-test-key",
      LAPAKVIP_MODEL: "lv/deepseek-v4.1-flash",
    } as unknown as NodeJS.ProcessEnv, "vision");
    expect(attempts.map(({ model }) => model)).toEqual([
      "lv/grok-4.6",
      "lv/claude-sonnet-4.5",
    ]);
  });

  it("falls back between LapakVIP models when the first returns invalid output", async () => {
    const requestedModels: string[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const { model } = JSON.parse(body) as { model: string };
      requestedModels.push(model);
      response.setHeader("Content-Type", "application/json");
      if (model === "lv/deepseek-v4.1-flash") {
        response.end(JSON.stringify({
          id: "invalid-primary",
          object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: "not-json" }, finish_reason: "stop" }],
        }));
        return;
      }
      response.end(JSON.stringify({
        id: "valid-fallback",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: '{"ok":true}' }, finish_reason: "stop" }],
      }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      const result = await callRoutedAI({
        messages: [{ role: "user", content: "Return JSON" }],
        jsonMode: true,
        validateContent: (content) => { JSON.parse(content); },
        environment: {
          LAPAKVIP_API_KEY: "lapakvip-test-key",
          LAPAKVIP_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          LAPAKVIP_MODEL: "lv/deepseek-v4.1-flash",
          LAPAKVIP_FALLBACK_MODELS: "lv/grok-4.6",
          AI_REQUEST_TIMEOUT_MS: "5000",
          AI_TOTAL_TIMEOUT_MS: "15000",
        } as unknown as NodeJS.ProcessEnv,
      });
      expect(result).toMatchObject({ provider: "lapakvip", model: "lv/grok-4.6", content: '{"ok":true}' });
      expect(requestedModels).toEqual(["lv/deepseek-v4.1-flash", "lv/grok-4.6"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("crosses to OpenRouter after LapakVIP model failures", async () => {
    const requestedModels: string[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      const { model } = JSON.parse(body) as { model: string };
      requestedModels.push(model);
      response.setHeader("Content-Type", "application/json");
      if (model === "lv/deepseek-v4.1-flash") {
        response.end(JSON.stringify({ error: { message: "Gateway overloaded" } }));
        return;
      }
      if (model.startsWith("lv/")) {
        response.writeHead(503).end(JSON.stringify({ error: { message: "Provider overloaded" } }));
        return;
      }
      response.end(JSON.stringify({
        id: "openrouter-fallback",
        object: "chat.completion",
        choices: [{ index: 0, message: { role: "assistant", content: "Fallback aktif" }, finish_reason: "stop" }],
      }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address() as AddressInfo;
      const result = await callRoutedAI({
        messages: [{ role: "user", content: "Test fallback" }],
        environment: {
          LAPAKVIP_API_KEY: "lapakvip-test-key",
          LAPAKVIP_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          LAPAKVIP_MODEL: "lv/deepseek-v4.1-flash",
          LAPAKVIP_FALLBACK_MODELS: "lv/grok-4.6",
          OPENROUTER_API_KEY: "openrouter-test-key",
          OPENROUTER_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
          OPENROUTER_MODEL: "openrouter/fallback",
          AI_REQUEST_TIMEOUT_MS: "5000",
          AI_TOTAL_TIMEOUT_MS: "15000",
        } as unknown as NodeJS.ProcessEnv,
      });
      expect(result).toMatchObject({ provider: "openrouter", model: "openrouter/fallback" });
      expect(requestedModels).toEqual(["lv/deepseek-v4.1-flash", "lv/grok-4.6", "openrouter/fallback"]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("uses one CodeCraft primary, three fallbacks, then OpenRouter", () => {
    const attempts = buildAIProviderAttempts({
      CODECRAFT_API_KEY: "codecraft-test-key",
      CODECRAFT_MODEL: "claude-sonnet-5",
      CODECRAFT_FALLBACK_MODELS: "gpt-5.6-sol,claude-opus-5,qwen3.8-max",
      OPENROUTER_API_KEY: "openrouter-test-key",
      OPENROUTER_MODEL: "openrouter/fallback",
    } as unknown as NodeJS.ProcessEnv);

    expect(attempts.map(({ provider, model }) => `${provider}:${model}`)).toEqual([
      "codecraft:claude-sonnet-5",
      "codecraft:gpt-5.6-sol",
      "codecraft:claude-opus-5",
      "codecraft:qwen3.8-max",
      "openrouter:openrouter/fallback",
    ]);
  });

  it("keeps OpenRouter usable when CodeCraft is unavailable", () => {
    const attempts = buildAIProviderAttempts({
      OPENROUTER_API_KEY: "openrouter-test-key",
      OPENROUTER_MODEL: "openrouter/fallback",
    } as unknown as NodeJS.ProcessEnv);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.provider).toBe("openrouter");
  });

  it("prioritizes the configured reasoning model without removing fallbacks", () => {
    const attempts = buildAIProviderAttempts({
      CODECRAFT_API_KEY: "codecraft-test-key",
      CODECRAFT_MODEL: "claude-sonnet-5",
      CODECRAFT_REASONING_MODEL: "gpt-5.6-sol",
      CODECRAFT_FALLBACK_MODELS: "gpt-5.6-sol,claude-opus-5,qwen3.8-max",
      OPENROUTER_API_KEY: "openrouter-test-key",
      OPENROUTER_MODEL: "openrouter/general",
      OPENROUTER_REASONING_MODEL: "openrouter/reasoning",
    } as unknown as NodeJS.ProcessEnv, "reasoning");

    expect(attempts.map(({ provider, model }) => `${provider}:${model}`)).toEqual([
      "codecraft:gpt-5.6-sol",
      "codecraft:claude-sonnet-5",
      "codecraft:claude-opus-5",
      "codecraft:qwen3.8-max",
      "openrouter:openrouter/reasoning",
    ]);
  });

  it("prioritizes a vision-capable model and retains OpenRouter as final fallback", () => {
    const attempts = buildAIProviderAttempts({
      CODECRAFT_API_KEY: "codecraft-test-key",
      CODECRAFT_MODEL: "claude-sonnet-5",
      CODECRAFT_VISION_MODEL: "claude-opus-5",
      CODECRAFT_FALLBACK_MODELS: "gpt-5.6-sol,claude-opus-5,qwen3.8-max",
      OPENROUTER_API_KEY: "openrouter-test-key",
      OPENROUTER_MODEL: "openrouter/general",
      OPENROUTER_VISION_MODEL: "openrouter/vision",
    } as unknown as NodeJS.ProcessEnv, "vision");

    expect(attempts.map(({ provider, model }) => `${provider}:${model}`)).toEqual([
      "codecraft:claude-opus-5",
      "codecraft:claude-sonnet-5",
      "codecraft:gpt-5.6-sol",
      "codecraft:qwen3.8-max",
      "openrouter:openrouter/vision",
    ]);
  });

  it("does not expose API keys in provider selection output consumed by callers", () => {
    const attempts = buildAIProviderAttempts({ CODECRAFT_API_KEY: "secret-value" } as unknown as NodeJS.ProcessEnv);
    expect(attempts.map(({ provider, model }) => ({ provider, model }))).toEqual([
      { provider: "codecraft", model: "claude-sonnet-5" },
      { provider: "codecraft", model: "gpt-5.6-sol" },
      { provider: "codecraft", model: "claude-opus-5" },
      { provider: "codecraft", model: "qwen3.8-max" },
    ]);
  });
});
