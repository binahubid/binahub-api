import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { retentionOpportunitySchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, retentionOpportunitySchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_RETENTION_OPPORTUNITY");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("save_retention_opportunity", {
    p_id: input.id || null,
    p_client_account_id: input.clientAccountId,
    p_source_project_id: input.sourceProjectId || null,
    p_actor: admin.email,
    p_opportunity_type: input.opportunityType,
    p_status: input.status,
    p_owner: input.owner,
    p_module_request_data: input.moduleRequestData,
    p_estimated_value: input.estimatedValue ?? null,
    p_expected_close_date: input.expectedCloseDate || null,
    p_next_action: input.nextAction || null,
    p_next_action_due_at: input.nextActionDueAt || null,
    p_lost_reason: input.lostReason || null,
    p_human_approved: input.humanApproved,
    p_approval_note: input.approvalNote || null,
  });

  if (error) {
    if (error.message.includes("CLIENT_ACCOUNT_NOT_FOUND")) return adminError("Client account tidak ditemukan.", 404, "CLIENT_ACCOUNT_NOT_FOUND");
    if (error.message.includes("DELIVERY_PROJECT_NOT_FOUND")) return adminError("Project tidak terhubung ke client ini.", 404, "DELIVERY_PROJECT_NOT_FOUND");
    if (error.message.includes("RETENTION_HUMAN_APPROVAL_REQUIRED")) return adminError("Status proposal/won membutuhkan approval manusia dan catatan.", 400, "RETENTION_HUMAN_APPROVAL_REQUIRED");
    if (error.message.includes("RETENTION_NEXT_ACTION_REQUIRED")) return adminError("Retention opportunity aktif membutuhkan next action dan tenggat.", 400, "RETENTION_NEXT_ACTION_REQUIRED");
    if (error.message.includes("RETENTION_LOST_REASON_REQUIRED")) return adminError("Alasan lost wajib diisi.", 400, "RETENTION_LOST_REASON_REQUIRED");
    return adminError(error.message, 500, "RETENTION_SAVE_FAILED");
  }
  return NextResponse.json({ success: true, opportunity: data });
}
