import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServerSupabase } from "@/lib/supabase";
import { getCorsHeaders } from "@/lib/cors";
import { recordRuntimeError } from "@/lib/runtime-observability";

const payloadSchema = z.object({
  message: z.string().min(1).max(1000), stack: z.string().max(6000).optional(),
  route: z.string().max(300).optional(), code: z.string().max(80).optional(),
  release: z.string().max(100).optional(),
}).strict();

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && !getCorsHeaders(origin)["Access-Control-Allow-Origin"]) {
    return NextResponse.json({ success: false }, { status: 403 });
  }
  const limited = await enforceRateLimit(req, "runtime-telemetry", 10, 60);
  if (limited) return limited;
  const { data: allowed, error } = await createServerSupabase().rpc("consume_api_rate_limit", {
    p_key_hash: "runtime-telemetry-global", p_limit: 1000, p_window_seconds: 3600,
  });
  if (error || !allowed) return NextResponse.json({ success: false }, { status: error ? 503 : 429 });
  if (Number(req.headers.get("content-length") || "0") > 12_000) {
    return NextResponse.json({ success: false }, { status: 413 });
  }
  const text = await req.text();
  if (text.length > 12_000) return NextResponse.json({ success: false }, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(text); } catch { return NextResponse.json({ success: false }, { status: 400 }); }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ success: false }, { status: 400 });
  const result = await recordRuntimeError(parsed.data, { trusted: false });
  return NextResponse.json({ success: result.stored }, { status: result.stored ? 202 : 503 });
}
