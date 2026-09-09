import OpenAI from "openai";

export type AIMessageContent = string | Array<
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
>;

export type AIRoutedMessage = {
  role: "system" | "user" | "assistant";
  content: AIMessageContent;
};

export type AIProviderAttempt = {
  provider: "codecraft" | "openrouter";
  model: string;
  baseURL: string;
  apiKey: string;
};

export type AIPurpose = "general" | "reasoning" | "vision";

function commaList(value: string | undefined) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function buildAIProviderAttempts(
  environment: NodeJS.ProcessEnv = process.env,
  purpose: AIPurpose = "general",
): AIProviderAttempt[] {
  const attempts: AIProviderAttempt[] = [];
  const codeCraftKey = environment.CODECRAFT_API_KEY?.trim();
  const generalModels = [
    environment.CODECRAFT_MODEL?.trim() || "claude-sonnet-5",
    ...commaList(environment.CODECRAFT_FALLBACK_MODELS || "gpt-5.6-sol,claude-opus-5,qwen3.8-max"),
  ];
  const purposeModel = purpose === "vision"
    ? environment.CODECRAFT_VISION_MODEL?.trim() || "claude-opus-5"
    : purpose === "reasoning"
      ? environment.CODECRAFT_REASONING_MODEL?.trim() || "claude-opus-5"
      : generalModels[0];
  const codeCraftModels = [purposeModel, ...generalModels];
  if (codeCraftKey) {
    for (const model of Array.from(new Set(codeCraftModels))) {
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
    attempts.push({
      provider: "openrouter",
      model: purpose === "vision"
        ? environment.OPENROUTER_VISION_MODEL?.trim() || environment.OPENROUTER_MODEL?.trim() || "arcee-ai/trinity-large-thinking:free"
        : purpose === "reasoning"
          ? environment.OPENROUTER_REASONING_MODEL?.trim() || environment.OPENROUTER_MODEL?.trim() || "arcee-ai/trinity-large-thinking:free"
          : environment.OPENROUTER_MODEL?.trim() || "arcee-ai/trinity-large-thinking:free",
      baseURL: environment.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
      apiKey: openRouterKey,
    });
  }
  return attempts;
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const value = (error as { status?: unknown }).status;
  return typeof value === "number" ? value : null;
}

function publicFailure(error: unknown) {
  const status = statusCode(error);
  if (status) return `HTTP ${status}`;
  return error instanceof Error ? error.name : "unknown error";
}

export async function callRoutedAI(input: {
  messages: AIRoutedMessage[];
  jsonMode?: boolean;
  purpose?: AIPurpose;
  environment?: NodeJS.ProcessEnv;
}) {
  const environment = input.environment || process.env;
  const attempts = buildAIProviderAttempts(environment, input.purpose);
  if (!attempts.length) {
    throw new Error("AI provider belum dikonfigurasi. Isi CODECRAFT_API_KEY atau OPENROUTER_API_KEY.");
  }

  const failures: Array<{ provider: string; model: string; failure: string }> = [];
  const maxTokens = Math.max(2048, Math.min(Number(environment.AI_MAX_TOKENS) || 8192, 32768));
  let blockedProvider: string | null = null;

  for (const attempt of attempts) {
    if (blockedProvider === attempt.provider) continue;
    const client = new OpenAI({
      apiKey: attempt.apiKey,
      baseURL: attempt.baseURL,
      timeout: Math.max(5_000, Math.min(Number(environment.AI_REQUEST_TIMEOUT_MS) || 45_000, 120_000)),
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
        response_format: input.jsonMode
          && attempt.provider === "codecraft"
          && environment.AI_JSON_MODE_ENABLED === "true"
          ? { type: "json_object" }
          : undefined,
      });
      const message = response.choices[0]?.message as (OpenAI.Chat.Completions.ChatCompletionMessage & {
        reasoning_content?: string | null;
      }) | undefined;
      if (!message?.content) throw new Error("Empty response from AI model");
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
      if ([401, 402, 403].includes(status || 0)) blockedProvider = attempt.provider;
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
