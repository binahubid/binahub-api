import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { deliveryMilestoneSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, deliveryMilestoneSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_MILESTONE");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("save_delivery_milestone", {
    p_id: input.id || null,
    p_project_id: input.projectId,
    p_actor: admin.email,
    p_title: input.title,
    p_description: input.description || null,
    p_owner: input.owner,
    p_due_date: input.dueDate || null,
    p_status: input.status,
    p_progress: input.progress,
    p_weight: input.weight,
    p_blocker_reason: input.blockerReason || null,
  });

  if (error) {
    if (error.message.includes("DELIVERY_PROJECT_NOT_FOUND")) return adminError("Delivery project tidak ditemukan.", 404, "DELIVERY_PROJECT_NOT_FOUND");
    if (error.message.includes("MILESTONE_NOT_FOUND")) return adminError("Milestone tidak ditemukan.", 404, "MILESTONE_NOT_FOUND");
    if (error.message.includes("BLOCKER_REASON_REQUIRED")) return adminError("Alasan blocker wajib diisi.", 400, "BLOCKER_REASON_REQUIRED");
    return adminError(error.message, 500, "MILESTONE_SAVE_FAILED");
  }
  return NextResponse.json({ success: true, milestone: data });
}
