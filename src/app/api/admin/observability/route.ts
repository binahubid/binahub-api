import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { recordRuntimeError } from "@/lib/runtime-observability";
import { z } from "zod";

const response = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return response({ success: false, error: "Admin required." }, admin.status);
  const db = createServerSupabase();
  const [events, count] = await Promise.all([
    db.from("runtime_error_events").select("*").order("last_seen_at", { ascending: false }).limit(50),
    db.from("runtime_error_events").select("id", { count: "exact", head: true }).eq("status", "open").eq("synthetic", false),
  ]);
  if (events.error || count.error) return response({ success: false, error: "Log internal belum tersedia." }, 503);
  return response({ success: true, provider: "supabase", retentionDaysAfterAcknowledgement: 30,
    openCount: count.count || 0, events: events.data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return response({ success: false, error: "Admin required." }, admin.status);
  const body = await req.json().catch(() => null);
  if (body?.action !== "send_test_event") return response({ success: false }, 400);
  const result = await recordRuntimeError({
    message: "BinaHub synthetic observability verification", code: "SINK_VERIFICATION",
    route: "/api/admin/observability",
  }, { synthetic: true });
  return response({ success: result.stored, eventId: result.id, stored: result.stored,
    alertChannel: "admin_dashboard", outboundTriggered: false }, result.stored ? 200 : 503);
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return response({ success: false, error: "Admin required." }, admin.status);
  const body = z.object({ id: z.string().uuid(), expectedCount: z.number().int().positive() })
    .strict().safeParse(await req.json().catch(() => null));
  if (!body.success) return response({ success: false }, 400);
  const { data, error } = await createServerSupabase().from("runtime_error_events").update({
    status: "acknowledged", acknowledged_by: admin.email, acknowledged_at: new Date().toISOString(),
  }).eq("id", body.data.id).eq("occurrence_count", body.data.expectedCount).select("id").maybeSingle();
  if (error || !data) return response({ success: false, error: "Log berubah atau tidak ditemukan. Perbarui sebelum menandai." }, 409);
  return response({ success: true, id: data.id });
}
