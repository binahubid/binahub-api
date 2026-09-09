import { describe, expect, it } from "vitest";
import { buildAIProviderAttempts } from "./ai-provider";

describe("AI provider routing", () => {
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
