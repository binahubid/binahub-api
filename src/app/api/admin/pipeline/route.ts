import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { salesOpportunityUpdateSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, salesOpportunityUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_OPPORTUNITY_UPDATE");

  const input = parsed.data;
  const db = createServerSupabase();
  const { data, error } = await db.rpc("update_sales_opportunity", {
    p_lead_id: input.leadId,
    p_stage: input.stage,
    p_actor: admin.email,
    p_owner: input.owner || null,
    p_next_action: input.nextAction || null,
    p_next_action_due_at: input.nextActionDueAt || null,
    p_note: input.note || null,
    p_lost_reason: input.lostReason || null,
    p_opportunity_value: input.opportunityValue ?? null,
    p_lead_time_zone: input.leadTimeZone || null,
    p_outreach_paused: input.outreachPaused ?? null,
    p_outreach_pause_reason: input.outreachPauseReason || null,
  });

  if (error) {
    if (error.message.includes("LEAD_NOT_FOUND")) return adminError("Lead tidak ditemukan.", 404, "LEAD_NOT_FOUND");
    if (error.message.includes("LOST_REASON_REQUIRED")) return adminError("Alasan lost wajib diisi.", 400, "LOST_REASON_REQUIRED");
    if (error.message.includes("OPPORTUNITY_OWNER_REQUIRED")) return adminError("Owner peluang wajib ditetapkan.", 400, "OPPORTUNITY_OWNER_REQUIRED");
    if (error.message.includes("NEXT_ACTION_REQUIRED")) return adminError("Next action wajib diisi untuk peluang aktif.", 400, "NEXT_ACTION_REQUIRED");
    if (error.message.includes("NEXT_ACTION_DUE_AT_REQUIRED")) return adminError("Tenggat next action wajib diisi untuk peluang aktif.", 400, "NEXT_ACTION_DUE_AT_REQUIRED");
    return adminError(error.message, 500, "OPPORTUNITY_UPDATE_FAILED");
  }

  return NextResponse.json({ success: true, opportunity: data });
}
