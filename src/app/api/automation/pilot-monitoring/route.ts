import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { runOperationalAssuranceScan } from "@/lib/operational-assurance-scan";
import { createServerSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const secret = process.env.PILOT_MONITOR_SECRET;
  const token = getBearerToken(req.headers.get("authorization"));
  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Akses pilot monitoring watchdog tidak valid." }, { status: 403 });
  }

  const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) {
    return NextResponse.json({ success: false, error: "Idempotency key terlalu panjang." }, { status: 400 });
  }
  const dryRun = process.env.PILOT_MONITOR_DRY_RUN !== "false";
  try {
    const scan = await runOperationalAssuranceScan({
      db: createServerSupabase(),
      actor: "automation:pilot-monitoring",
      materializeIncidents: !dryRun,
      idempotencyKey,
    });
    return NextResponse.json({
      success: true,
      dryRun,
      activationLocked: true,
      outboundTriggered: false,
      scan,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      dryRun,
      error: error instanceof Error ? error.message : "Pilot monitoring watchdog gagal.",
    }, { status: 500 });
  }
}
