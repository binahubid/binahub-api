import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { loadServiceHealth } from "@/lib/service-health";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "no-store, max-age=0",
  Vary: "Authorization",
};

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin)
    return NextResponse.json(
      { success: false, error: "Akses admin diperlukan." },
      { status: admin.status, headers },
    );
  try {
    return NextResponse.json(
      {
        success: true,
        health: await loadServiceHealth(createServerSupabase()),
      },
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        success: true,
        health: { readiness: "unavailable", operations: "unknown" },
      },
      { headers },
    );
  }
}

// The overview GET describes missing evidence; an authenticated readiness probe
// must explicitly fail rather than interpreting a successful HTTP GET as ready.
export async function HEAD(req: NextRequest) {
  const result = await GET(req);
  if (result.status !== 200)
    return new NextResponse(null, { status: result.status, headers });
  const body = await result.json();
  return new NextResponse(null, {
    status: body.health.readiness === "ready" ? 200 : 503,
    headers,
  });
}
