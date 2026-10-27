import OpenAI from "openai";
import { orderedProviders, type AIRoutingPolicy } from "./ai-routing-policy";

export type AIMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

export type AIRoutedMessage = {
  role: "system" | "user" | "assistant";
  content: AIMessageContent;
};

export type AIProviderAttempt = {
  provider: "lapakvip" | "codecraft" | "openrouter";
  model: string;
  baseURL: string;
  apiKey: string;
};

export type AIPurpose = "general" | "reasoning" | "vision";

export type AIRequestBudget = {
  maxTokens?: number;
  perAttemptTimeoutMs?: number;
  totalTimeoutMs?: number;
};

const OPENROUTER_DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl:free";

function commaList(value: string | undefined) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeLapakVipModel(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized.startsWith("lv/")) return normalized;
  if (normalized.startsWith("deepseek/")) return `lv/${normalized.slice("deepseek/".length)}`;
  if (normalized.startsWith("x-ai/")) return `lv/${normalized.slice("x-ai/".length)}`;
  return `lv/${normalized}`;
}

export function buildAIProviderAttempts(
  environment: NodeJS.ProcessEnv = process.env,
  purpose: AIPurpose = "general",
  policy?: AIRoutingPolicy | null,
): AIProviderAttempt[] {
  const attempts: AIProviderAttempt[] = [];
  const lapakVipKey = environment.LAPAKVIP_API_KEY?.trim();
  if (lapakVipKey) {
    const generalModel = environment.LAPAKVIP_MODEL?.trim() || "lv/deepseek-v4.1-flash";
    const models = purpose === "vision"
      ? [
          environment.LAPAKVIP_VISION_MODEL?.trim() || "lv/grok-4.6",
          ...commaList(environment.LAPAKVIP_VISION_FALLBACK_MODELS || "lv/claude-sonnet-4.5"),
        ]
      : [
          purpose === "reasoning" ? environment.LAPAKVIP_REASONING_MODEL?.trim() || generalModel : generalModel,
          generalModel,
          ...commaList(environment.LAPAKVIP_FALLBACK_MODELS || "lv/grok-4.6"),
        ];
    for (const model of new Set(models.map(normalizeLapakVipModel))) {
      attempts.push({
        provider: "lapakvip",
        model,
        baseURL: environment.LAPAKVIP_BASE_URL?.trim() || "https://router.lapakvip.com/api/v1",
        apiKey: lapakVipKey,
      });
    }
  }

  // Keep the old deployment usable until LAPAKVIP_API_KEY is set, but never
  // spend time on the known-broken CodeCraft account after LapakVIP is active.
  const codeCraftKey = environment.CODECRAFT_API_KEY?.trim();
  if ((policy || !lapakVipKey) && codeCraftKey) {
    const generalModels = [
      environment.CODECRAFT_MODEL?.trim() || "claude-sonnet-5",
      ...commaList(environment.CODECRAFT_FALLBACK_MODELS || "gpt-5.6-sol,claude-opus-5,qwen3.8-max"),
    ];
    const purposeModel = purpose === "vision"
      ? environment.CODECRAFT_VISION_MODEL?.trim() || "claude-opus-5"
      : purpose === "reasoning"
        ? environment.CODECRAFT_REASONING_MODEL?.trim() || "claude-opus-5"
        : generalModels[0];
    for (const model of new Set([purposeModel, ...generalModels])) {
      attempts.push({
        provider: "codecraft",
        model,
        baseURL: environment.CODECRAFT_BASE_URL?.trim() || "https://codecraftapi.com/v1",
        apiKey: codeCraftKey,
      });
    }
  }

  const openRouterKey = environment.OPENROUTER_API_KEY?.trim();
  if (openRouterKey) {
    const generalModel = environment.OPENROUTER_MODEL?.trim() || OPENROUTER_DEFAULT_MODEL;
    const primaryModel = purpose === "vision" ? environment.OPENROUTER_VISION_MODEL?.trim() || generalModel
      : purpose === "reasoning" ? environment.OPENROUTER_REASONING_MODEL?.trim() || generalModel : generalModel;
    const fallbackModels = commaList(environment.OPENROUTER_FALLBACK_MODELS ?? OPENROUTER_DEFAULT_MODEL);
    for (const model of new Set([primaryModel, ...fallbackModels])) attempts.push({
      provider: "openrouter",
      model,
      baseURL: environment.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      apiKey: openRouterKey,
    });
  }
  if (!policy) return attempts;
  return orderedProviders(policy).flatMap((provider) => attempts.filter((attempt) => attempt.provider === provider));
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : null;
}

function publicFailure(error: unknown) {
  const status = statusCode(error);
  if (status) return `HTTP ${status}`;
  if (error instanceof SyntaxError || error instanceof Error && /invalid ai response|invalid ai assessment/i.test(error.message)) {
    return "invalid_output";
  }
  if (error instanceof Error && /provider error response/i.test(error.message)) return "provider_error";
  if (error instanceof Error && /timeout|timed out/i.test(`${error.name} ${error.message}`)) return "timeout";
  return error instanceof Error ? error.name : "unknown error";
}

export async function callRoutedAI(input: {
  messages: AIRoutedMessage[];
  jsonMode?: boolean;
  temperature?: number;
  purpose?: AIPurpose;
  environment?: NodeJS.ProcessEnv;
  routingPolicy?: AIRoutingPolicy | null;
  validateContent?: (content: string) => void;
  budget?: AIRequestBudget;
}) {
  const environment = input.environment || process.env;
  const policy = input.routingPolicy !== undefined ? input.routingPolicy
    : input.environment ? null : await (await import("./ai-provider-settings")).loadAIRoutingPolicy();
  const attempts = buildAIProviderAttempts(environment, input.purpose, policy);
  if (!attempts.length) {
    throw new Error("AI provider belum dikonfigurasi. Isi LAPAKVIP_API_KEY pada environment API.");
  }

  const failures: Array<{ provider: string; model: string; failure: string }> = [];
  const maxTokens = Math.max(256, Math.min(input.budget?.maxTokens || Number(environment.AI_MAX_TOKENS) || 8192, 32768));
  const perAttemptTimeout = Math.max(5_000, Math.min(input.budget?.perAttemptTimeoutMs || Number(environment.AI_REQUEST_TIMEOUT_MS) || 25_000, 45_000));
  const totalTimeout = Math.max(10_000, Math.min(input.budget?.totalTimeoutMs || Number(environment.AI_TOTAL_TIMEOUT_MS) || 55_000, 120_000));
  const deadline = Date.now() + totalTimeout;
  const blockedCredentials = new Set<string>();
  let currentProvider: AIProviderAttempt["provider"] | undefined;
  let providerDeadline = deadline;

  for (const [index, attempt] of attempts.entries()) {
    const credentialId = `${attempt.baseURL.replace(/\/+$/, "")}|${attempt.apiKey}`;
    if (blockedCredentials.has(credentialId)) continue;
    const now = Date.now();
    const remaining = deadline - now;
    if (remaining < 1_000) break;
    if (attempt.provider !== currentProvider) {
      // Models on one provider share a fixed slice of the remaining budget.
      // Otherwise slow primary-model retries can starve OpenRouter entirely.
      const providersLeft = new Set(attempts.slice(index).filter((candidate) =>
        !blockedCredentials.has(`${candidate.baseURL.replace(/\/+$/, "")}|${candidate.apiKey}`),
      ).map((candidate) => candidate.provider)).size;
      currentProvider = attempt.provider;
      providerDeadline = now + Math.floor(remaining / providersLeft);
    }
    const providerRemaining = providerDeadline - now;
    if (providerRemaining < 1_000) continue;
    const modelSlots = attempt.provider === "openrouter"
      ? attempts.slice(index).filter((candidate) => candidate.provider === "openrouter").length : 1;
    const client = new OpenAI({
      apiKey: attempt.apiKey,
      baseURL: attempt.baseURL,
      timeout: Math.min(perAttemptTimeout, Math.floor(providerRemaining / modelSlots)),
      maxRetries: 0,
      defaultHeaders: attempt.provider === "openrouter" ? {
        "HTTP-Referer": environment.NEXT_PUBLIC_APP_URL || "",
        "X-Title": environment.NEXT_PUBLIC_COMPANY_NAME || "BinaHub",
      } : undefined,
    });

    try {
      const response = await client.chat.completions.create({
        model: attempt.model,
        messages: input.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: maxTokens,
        temperature: input.temperature,
        response_format: input.jsonMode
          && (attempt.provider === "lapakvip"
            ? environment.LAPAKVIP_JSON_MODE_ENABLED === "true"
            : attempt.provider === "codecraft" && environment.AI_JSON_MODE_ENABLED === "true")
          ? { type: "json_object" }
          : undefined,
      });
      if (!Array.isArray(response.choices)) throw new Error("AI provider error response");
      const message = response.choices[0]?.message as (OpenAI.Chat.Completions.ChatCompletionMessage & {
        reasoning_content?: string | null;
      }) | undefined;
      if (!message?.content) throw new Error("Empty response from AI model");
      input.validateContent?.(message.content);
      return {
        content: message.content,
        reasoningContent: environment.AI_REASONING_ENABLED === "true" ? message.reasoning_content || null : null,
        provider: attempt.provider,
        model: attempt.model,
        usage: response.usage || null,
      };
    } catch (error) {
      const status = statusCode(error);
      failures.push({ provider: attempt.provider, model: attempt.model, failure: publicFailure(error) });
      console.warn(`[AI Router] ${attempt.provider}/${attempt.model} gagal (${publicFailure(error)}); mencoba fallback.`);
      // Authentication, billing, and permission failures apply to the provider
      // account. A 429 may be model-specific, so retain the remaining model
      // fallbacks before crossing the provider boundary.
      if ([401, 402, 403].includes(status || 0)) blockedCredentials.add(credentialId);
    }
  }

  throw new Error(`Seluruh AI provider gagal: ${failures.map((item) => `${item.provider}/${item.model} ${item.failure}`).join("; ")}`);
}

export async function analyzeImageWithAI(input: {
  prompt: string;
  imageUrl: string;
  systemPrompt?: string;
}) {
  return callRoutedAI({
    purpose: "vision",
    messages: [
      { role: "system", content: input.systemPrompt || "Analisis gambar secara akurat dan jangan mengarang detail yang tidak terlihat." },
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          { type: "image_url", image_url: { url: input.imageUrl } },
        ],
      },
    ],
  });
}
