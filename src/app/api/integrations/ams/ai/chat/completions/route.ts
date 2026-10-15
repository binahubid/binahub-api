import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAmsSignature } from "@/lib/ams-integration";
import { callRoutedAI } from "@/lib/ai-provider";

export const runtime = "nodejs";
export const maxDuration = 90;
const schema = z.object({
  model: z.literal("binahub-managed"),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(200_000) }).strict()).min(1).max(20),
  max_tokens: z.number().int().min(256).max(32768).optional(),
  temperature: z.number().min(0).max(2).optional(),
  response_format: z.object({ type: z.literal("json_object") }).strict().optional(),
}).strict();
const headers = { "Cache-Control": "no-store" };
function fail(message: string, status: number) {
  return NextResponse.json({ error: { message, type: "binahub_ai_error" } }, { status, headers });
}
export async function POST(req: NextRequest) {
  // A server-to-server endpoint, never an anonymous public AI proxy.
  if (Number(req.headers.get("content-length")) > 512_000) return fail("Permintaan terlalu besar.", 413);
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 512_000) return fail("Permintaan terlalu besar.", 413);
  const auth = verifyAmsSignature(raw, req.headers.get("x-binahub-timestamp"), req.headers.get("x-binahub-signature"));
  if (!auth.ok) return fail(auth.error, auth.status);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return fail("JSON tidak valid.", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail("Format permintaan AI tidak valid.", 400);
  try {
    const jsonMode = parsed.data.response_format?.type === "json_object";
    let normalizedContent: string | undefined;
    const result = await callRoutedAI({
      messages: parsed.data.messages, jsonMode, temperature: parsed.data.temperature,
      budget: { maxTokens: parsed.data.max_tokens, totalTimeoutMs: 55_000 },
      validateContent: jsonMode ? (content) => {
        const normalized = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const value = JSON.parse(normalized);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid AI response");
        normalizedContent = JSON.stringify(value);
      } : undefined,
    });
    return NextResponse.json({
      id: `chatcmpl-${randomUUID()}`, object: "chat.completion", created: Math.floor(Date.now() / 1000),
      model: result.model, provider: result.provider,
      choices: [{ index: 0, message: { role: "assistant", content: normalizedContent || result.content }, finish_reason: "stop" }],
      usage: result.usage,
    }, { headers });
  } catch { return fail("Layanan AI belum dapat menyelesaikan permintaan. Silakan coba lagi.", 503); }
}
