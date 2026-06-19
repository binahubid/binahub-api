import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";

const smartActionPatchSchema = z.object({
  id: z.string().trim().min(1, "ID smart action wajib diisi."),
  status: z.enum(["Pending", "In Progress", "Completed", "Dismissed"]),
});

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const { data, error } = await createServerSupabase()
    .from("smart_actions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, actions: data || [] });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, smartActionPatchSchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_SMART_ACTION_PAYLOAD");
  }

  const { id, status } = parsed.data;
  const db = createServerSupabase();
  const { data, error } = await db
    .from("smart_actions")
    .update({
      status,
      executed_by: admin.email,
      executed_at: status === "Completed" || status === "Dismissed" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "SMART_ACTION_UPDATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "smart_action_status_updated",
    targetType: "smart_action",
    targetId: id,
    actor: admin.email,
    payload: { status },
    message: `Smart action diubah menjadi ${status}.`,
  });

  return NextResponse.json({ success: true, action: data });
}
