import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";

export function requestFingerprint(req: NextRequest, scope: string) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = req.headers.get("x-real-ip") || forwarded || "unknown";
  return createHash("sha256").update(`${scope}:${address}`).digest("hex");
}

export async function enforceRateLimit(
  req: NextRequest,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  const db = createServerSupabase();
  const { data, error } = await db.rpc("consume_api_rate_limit", {
    p_key_hash: requestFingerprint(req, scope),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error(`[Rate Limit] ${scope}:`, error.message);
    return NextResponse.json({ success: false, error: "Layanan sementara tidak tersedia." }, { status: 503 });
  }
  if (!data) {
    return NextResponse.json(
      { success: false, error: "Terlalu banyak permintaan. Silakan coba lagi nanti." },
      { status: 429, headers: { "Retry-After": String(windowSeconds) } },
    );
  }
  return null;
}
