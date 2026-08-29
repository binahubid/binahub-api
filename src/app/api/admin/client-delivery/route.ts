import { NextRequest, NextResponse } from "next/server";
import { adminError, logAdminEvent, parseJsonBody, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import {
  clientAccountUpdateSchema,
  clientHandoffSchema,
  deliveryProjectUpdateSchema,
} from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

function phase3RpcError(message: string) {
  const knownErrors: Record<string, [string, number]> = {
    LEAD_NOT_FOUND: ["Lead tidak ditemukan.", 404],
    LEAD_NOT_WON: ["Hanya opportunity berstatus won yang dapat dikonversi menjadi client.", 409],
    COMPANY_REQUIRED: ["Nama perusahaan wajib tersedia sebelum handoff.", 400],
    COMMERCIAL_OWNER_REQUIRED: ["Commercial owner wajib ditetapkan.", 400],
    DELIVERY_OWNER_REQUIRED: ["Delivery owner wajib ditetapkan.", 400],
    PROJECT_TITLE_REQUIRED: ["Nama project awal wajib diisi.", 400],
    CLIENT_ACCOUNT_NOT_FOUND: ["Client account tidak ditemukan.", 404],
    DELIVERY_PROJECT_NOT_FOUND: ["Delivery project tidak ditemukan.", 404],
    CHANGE_REASON_REQUIRED: ["Alasan perubahan status wajib diisi.", 400],
    ACCOUNT_OWNERS_REQUIRED: ["Commercial owner dan delivery owner wajib ditetapkan.", 400],
    RISK_SUMMARY_REQUIRED: ["Ringkasan risiko wajib diisi.", 400],
    INVALID_PROJECT_DATE_RANGE: ["Tanggal selesai tidak boleh sebelum tanggal mulai.", 400],
  };
  const match = Object.entries(knownErrors).find(([key]) => message.includes(key));
  return match ? { message: match[1][0], status: match[1][1], code: match[0] } : null;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, clientHandoffSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_CLIENT_HANDOFF");

  const input = parsed.data;
  const db = createServerSupabase();
  const { data, error } = await db.rpc("convert_won_lead_to_client", {
    p_lead_id: input.leadId,
    p_actor: admin.email,
    p_commercial_owner: input.commercialOwner,
    p_delivery_owner: input.deliveryOwner,
    p_project_title: input.projectTitle,
    p_kickoff_date: input.kickoffDate || null,
  });

  if (error) {
    const known = phase3RpcError(error.message);
    if (known) return adminError(known.message, known.status, known.code);
    return adminError(error.message, 500, "CLIENT_HANDOFF_FAILED");
  }

  const result = data as { account?: { id?: string }; project?: { id?: string } } | null;
  await logAdminEvent(db, {
    eventType: "client_handoff_created",
    targetType: "client_account",
    targetId: result?.account?.id || null,
    actor: admin.email,
    payload: { leadId: input.leadId, projectId: result?.project?.id || null },
    message: `Won lead dikonversi menjadi client oleh ${admin.email}.`,
  });

  return NextResponse.json({ success: true, result });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const body = await parseJsonBody(req);
  if (body.error || !body.data) return adminError(body.error || "Payload tidak valid.", 400, "INVALID_PHASE3_UPDATE");
  const action = body.data.action;
  const payload = body.data.payload;
  if ((action !== "account" && action !== "project") || !payload || typeof payload !== "object" || Array.isArray(payload)) {
    return adminError("Action atau payload Fase 3 tidak valid.", 400, "INVALID_PHASE3_UPDATE");
  }

  const db = createServerSupabase();
  if (action === "account") {
    const parsed = clientAccountUpdateSchema.safeParse(payload);
    if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Payload account tidak valid.", 400, "INVALID_CLIENT_ACCOUNT_UPDATE");
    const input = parsed.data;
    const { data, error } = await db.rpc("update_client_account", {
      p_client_account_id: input.clientAccountId,
      p_actor: admin.email,
      p_status: input.status,
      p_commercial_owner: input.commercialOwner,
      p_delivery_owner: input.deliveryOwner,
      p_next_review_at: input.nextReviewAt || null,
      p_renewal_date: input.renewalDate || null,
      p_retain_status: input.retainStatus,
      p_notes: input.notes || null,
      p_change_reason: input.changeReason || null,
    });
    if (error) {
      const known = phase3RpcError(error.message);
      if (known) return adminError(known.message, known.status, known.code);
      return adminError(error.message, 500, "CLIENT_ACCOUNT_UPDATE_FAILED");
    }
    return NextResponse.json({ success: true, account: data });
  }

  const parsed = deliveryProjectUpdateSchema.safeParse(payload);
  if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Payload delivery tidak valid.", 400, "INVALID_DELIVERY_UPDATE");
  const input = parsed.data;
  const { data, error } = await db.rpc("update_delivery_project", {
    p_project_id: input.projectId,
    p_actor: admin.email,
    p_delivery_stage: input.deliveryStage,
    p_delivery_owner: input.deliveryOwner || null,
    p_start_date: input.startDate || null,
    p_end_date: input.endDate || null,
    p_delivery_goal: input.deliveryGoal || null,
    p_success_metrics: input.successMetrics,
    p_risk_level: input.riskLevel,
    p_risk_summary: input.riskSummary || null,
    p_note: input.note || null,
  });
  if (error) {
    const known = phase3RpcError(error.message);
    if (known) return adminError(known.message, known.status, known.code);
    return adminError(error.message, 500, "DELIVERY_PROJECT_UPDATE_FAILED");
  }
  return NextResponse.json({ success: true, project: data });
}
