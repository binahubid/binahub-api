import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { LeadDiscoveryError, runLeadDiscovery } from "@/lib/lead-discovery-service";
import { createServerSupabase } from "@/lib/supabase";

function scheduledKey() {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  return `n8n-lead-discovery:${bucket}`;
}

async function execute(req: NextRequest) {
  const secret = process.env.LEAD_AGENT_SECRET?.trim();
  if (!secret || getBearerToken(req.headers.get("authorization")) !== secret) {
    return NextResponse.json({ success: false, error: "Akses AI Lead Agent tidak valid." }, { status: 403 });
  }
  try {
    const result = await runLeadDiscovery({
      db: createServerSupabase(),
      actor: "automation:lead-discovery",
      idempotencyKey: req.headers.get("x-idempotency-key")?.trim() || scheduledKey(),
    });
    if (result.duplicate && result.run?.status === "failed") {
      return NextResponse.json({ success: false, duplicate: true, code: "FAILED_RUN_REQUIRES_NEW_WINDOW", error: "Run sebelumnya gagal setelah kandidat tersimpan; tinjau audit sebelum run baru." }, { status: 409 });
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof LeadDiscoveryError) {
      return NextResponse.json({ success: false, code: error.code, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "AI Lead Agent gagal." }, { status: 500 });
  }
}

export const GET = execute;
export const POST = execute;
