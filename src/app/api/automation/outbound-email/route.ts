import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { processOutboundQueue } from "@/lib/outbound-email";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  const secret = process.env.OUTBOUND_EMAIL_CRON_SECRET;
  if (!secret || getBearerToken(req.headers.get("authorization")) !== secret) return NextResponse.json({ success: false, error: "Akses worker tidak valid." }, { status: 403 });
  try { return NextResponse.json({ success: true, ...await processOutboundQueue() }); }
  catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Antrean belum dapat diproses." }, { status: 503 }); }
}
