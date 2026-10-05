import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const apiKey = process.env.LAPAKVIP_API_KEY?.trim();
const baseUrl = (process.env.LAPAKVIP_BASE_URL || "https://router.lapakvip.com/api/v1").replace(/\/+$/, "");

function normalizeModel(value) {
  const model = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (model.startsWith("lv/")) return model;
  if (model.startsWith("deepseek/")) return `lv/${model.slice("deepseek/".length)}`;
  if (model.startsWith("x-ai/")) return `lv/${model.slice("x-ai/".length)}`;
  return `lv/${model}`;
}

function modelList(value) {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean).map(normalizeModel);
}

const primaryModel = normalizeModel(process.env.LAPAKVIP_MODEL || "lv/deepseek-v4.1-flash");
const fallbackModels = modelList(process.env.LAPAKVIP_FALLBACK_MODELS || "lv/grok-4.6");
const reasoningModel = normalizeModel(process.env.LAPAKVIP_REASONING_MODEL || primaryModel);
const visionModel = normalizeModel(process.env.LAPAKVIP_VISION_MODEL || "lv/grok-4.6");
const visionFallbackModels = modelList(process.env.LAPAKVIP_VISION_FALLBACK_MODELS || "lv/claude-sonnet-4.5");

async function lapakVip(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(25_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`LapakVIP ${path} HTTP ${response.status}`);
  if (payload?.error) throw new Error(`LapakVIP ${path} mengembalikan error`);
  return payload;
}

async function completeWithFallback(models) {
  const failures = [];
  for (const model of [...new Set(models)]) {
    try {
      const result = await lapakVip("/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Balas singkat: BINAHUB_AI_SMOKE_OK" }],
          max_tokens: 64,
        }),
      });
      if (!result?.choices?.[0]?.message?.content) throw new Error("Respons AI kosong");
      console.log(`[PASS] Completion LapakVIP berhasil melalui ${model}`);
      return;
    } catch (error) {
      failures.push(`${model}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  throw new Error(`Semua model LapakVIP gagal: ${failures.join("; ")}`);
}

if (!apiKey) {
  console.error("[FAIL] LAPAKVIP_API_KEY belum tersedia di environment API lokal.");
  process.exitCode = 1;
} else {
  try {
    const catalog = await lapakVip("/models");
    const available = new Set((Array.isArray(catalog?.data) ? catalog.data : []).map((item) => normalizeModel(item.id)));
    const configured = new Set([primaryModel, ...fallbackModels, reasoningModel, visionModel, ...visionFallbackModels]);
    let catalogValid = true;
    for (const model of configured) {
      if (!available.has(model)) {
        console.error(`[FAIL] Model LapakVIP tidak tersedia untuk key ini: ${model}`);
        catalogValid = false;
      } else {
        console.log(`[PASS] Model LapakVIP tersedia: ${model}`);
      }
    }
    if (!catalogValid) process.exitCode = 1;
    else if (process.env.AI_SMOKE_SKIP_COMPLETIONS !== "true") {
      await completeWithFallback([reasoningModel, primaryModel, ...fallbackModels]);
    }
  } catch (error) {
    console.error(`[FAIL] ${error instanceof Error ? error.message : "Smoke LapakVIP gagal"}`);
    process.exitCode = 1;
  }
}
