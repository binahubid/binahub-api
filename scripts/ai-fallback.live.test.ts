import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadEnvConfig } from "@next/env";
import { expect, it } from "vitest";
import { callRoutedAI } from "../src/lib/ai-provider";

// Explicit opt-in: makes real, small provider requests, never uses client data.
it.skipIf(process.env.BINAHUB_AI_LIVE_SMOKE !== "true")("recovers from simulated provider failures through real OpenRouter", async () => {
  loadEnvConfig(process.cwd());
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required for the opt-in live smoke test");
  let simulatedFailures = 0;
  const server = createServer((request, response) => {
    request.resume(); simulatedFailures++;
    response.writeHead(402, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Synthetic account failure" } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const result = await callRoutedAI({
      environment: { ...process.env, LAPAKVIP_API_KEY: "synthetic-lapak", CODECRAFT_API_KEY: "synthetic-codecraft",
        LAPAKVIP_BASE_URL: baseURL, CODECRAFT_BASE_URL: baseURL },
      routingPolicy: { primaryProvider: "lapakvip", enabledProviders: ["lapakvip", "codecraft", "openrouter"] },
      messages: [{ role: "user", content: "Synthetic connectivity check. Reply exactly BINAHUB_OK. No explanation." }],
      budget: { maxTokens: 1024, perAttemptTimeoutMs: 15_000, totalTimeoutMs: 45_000 },
    });
    expect(simulatedFailures).toBe(2);
    expect(result.provider).toBe("openrouter");
    expect(result.content).toContain("BINAHUB_OK");
    console.info(JSON.stringify({ liveFallbackVerified: true, provider: result.provider, model: result.model }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}, 50_000);
