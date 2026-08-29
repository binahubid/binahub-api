import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { accountHealthReviewSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, accountHealthReviewSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_HEALTH_REVIEW");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("record_account_health_review", {
    p_client_account_id: input.clientAccountId,
    p_project_id: input.projectId || null,
    p_actor: admin.email,
    p_delivery_score: input.deliveryScore,
    p_engagement_score: input.engagementScore,
    p_sentiment_score: input.sentimentScore,
    p_commercial_score: input.commercialScore,
    p_risk_level: input.riskLevel,
    p_risk_reasons: input.riskReasons,
    p_notes: input.notes || null,
    p_next_action: input.nextAction || null,
    p_next_action_due_at: input.nextActionDueAt || null,
  });

  if (error) {
    if (error.message.includes("CLIENT_ACCOUNT_NOT_FOUND")) return adminError("Client account tidak ditemukan.", 404, "CLIENT_ACCOUNT_NOT_FOUND");
    if (error.message.includes("DELIVERY_PROJECT_NOT_FOUND")) return adminError("Project tidak terhubung ke client ini.", 404, "DELIVERY_PROJECT_NOT_FOUND");
    if (error.message.includes("HEALTH_NEXT_ACTION_REQUIRED")) return adminError("Account berisiko wajib memiliki next action dan tenggat.", 400, "HEALTH_NEXT_ACTION_REQUIRED");
    return adminError(error.message, 500, "HEALTH_REVIEW_FAILED");
  }
  return NextResponse.json({ success: true, review: data });
}
