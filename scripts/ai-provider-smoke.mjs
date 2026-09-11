import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const baseUrl = (process.env.CODECRAFT_BASE_URL || "https://codecraftapi.com/v1").replace(/\/+$/, "");
const apiKey = process.env.CODECRAFT_API_KEY?.trim();
const primaryModel = process.env.CODECRAFT_MODEL?.trim() || "claude-sonnet-5";
const fallbackModels = (process.env.CODECRAFT_FALLBACK_MODELS || "gpt-5.6-sol,claude-opus-5,qwen3.8-max")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const reasoningModel = process.env.CODECRAFT_REASONING_MODEL?.trim() || "claude-opus-5";
const visionModel = process.env.CODECRAFT_VISION_MODEL?.trim() || "claude-opus-5";

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exitCode = 1;
}

function smokeFailureMessage(error) {
  const status = error instanceof Error && "status" in error ? error.status : null;
  if (status === 403) {
    return "CodeCraft menolak key dengan HTTP 403. Di Dashboard → API Keys, aktifkan scope models:read dan inference untuk key ini, atau buat key baru dengan kedua scope tersebut.";
  }
  if (status === 402) {
    return "CodeCraft menolak request dengan HTTP 402. Periksa allowance atau saldo akun provider.";
  }
  return error instanceof Error ? error.message : "Smoke CodeCraft gagal.";
}

async function codeCraft(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const providerCode = typeof payload?.error?.code === "string"
      ? payload.error.code.replace(/[^a-z0-9_-]/gi, "").slice(0, 80)
      : "";
    const error = new Error(`CodeCraft ${path} gagal — HTTP ${response.status}${providerCode ? ` (${providerCode})` : ""}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function completeWithFallback({ label, models, messages }) {
  const failures = [];
  for (const model of Array.from(new Set(models))) {
    try {
      const result = await codeCraft("/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model, messages, max_tokens: 2048 }),
      });
      if (!result?.choices?.[0]?.message?.content) {
        throw new Error("respons kosong");
      }
      if (failures.length) {
        console.warn(`[WARN] ${label} menggunakan fallback ${model}; percobaan sebelumnya gagal: ${failures.join(", ")}`);
      }
      console.log(`[PASS] ${label} aktif melalui ${model}`);
      return { model, result };
    } catch (error) {
      const status = error instanceof Error && "status" in error ? error.status : null;
      failures.push(`${model}${status ? ` (HTTP ${status})` : ""}`);
    }
  }
  throw new Error(`${label} gagal pada seluruh model: ${failures.join(", ")}`);
}

if (!apiKey) {
  fail("CODECRAFT_API_KEY belum tersedia di environment lokal.");
} else {
  try {
    const catalog = await codeCraft("/models");
    const models = new Map((Array.isArray(catalog?.data) ? catalog.data : []).map((item) => [item.id, item]));
    const configured = Array.from(new Set([primaryModel, ...fallbackModels]));
    let catalogValid = true;

    for (const modelId of configured) {
      const model = models.get(modelId);
      if (!model) {
        catalogValid = false;
        fail(`model terkonfigurasi tidak tersedia untuk akun ini: ${modelId}`);
        continue;
      }
      const capabilities = Array.isArray(model.capabilities) ? model.capabilities.join(", ") : "tidak dipublikasikan";
      console.log(`[PASS] ${modelId} tersedia — capabilities: ${capabilities}`);
    }

    const reasoningCapabilities = models.get(reasoningModel)?.capabilities || [];
    if (!reasoningCapabilities.includes("reasoning")) {
      catalogValid = false;
      fail(`${reasoningModel} tidak mengiklankan capability reasoning.`);
    } else {
      console.log(`[PASS] reasoning diarahkan ke ${reasoningModel}`);
    }

    const visionCapabilities = models.get(visionModel)?.capabilities || [];
    if (!visionCapabilities.includes("vision")) {
      catalogValid = false;
      fail(`${visionModel} tidak mengiklankan capability vision.`);
    } else {
      console.log(`[PASS] vision diarahkan ke ${visionModel}`);
    }

    if (catalogValid && process.env.AI_SMOKE_SKIP_COMPLETIONS !== "true") {
      await completeWithFallback({
        label: "chat completion",
        models: configured,
        messages: [{ role: "user", content: "Balas tepat dengan teks: BINAHUB_AI_SMOKE_OK" }],
      });
      const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
      await completeWithFallback({
        label: "vision input",
        models: [visionModel, ...configured],
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Konfirmasi singkat bahwa gambar berhasil dibaca." },
            { type: "image_url", image_url: { url: onePixelPng } },
          ],
        }],
      });
    }

    if (catalogValid) {
      console.log("\nCodeCraft primary, tiga fallback, reasoning, dan vision siap. OpenRouter tetap menjadi fallback provider terakhir di runtime.");
    }
  } catch (error) {
    fail(smokeFailureMessage(error));
  }
}
