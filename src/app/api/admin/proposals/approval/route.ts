import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { proposalApprovalSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

const decisionMap = {
  approve: { approval: "approved", gate: "approved", proposal: "Disetujui" },
  reject: { approval: "rejected", gate: "rejected", proposal: "Revisi" },
  request_revision: { approval: "revision_required", gate: "revision_required", proposal: "Revisi" },
} as const;

const NON_OVERRIDABLE_GATE_REASONS = new Set([
  "DISCOUNT_LIMIT_EXCEEDED",
  "MODULE_NOT_READY",
  "INCOMPLETE_DATA",
]);

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, proposalApprovalSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_APPROVAL_DECISION");

  const input = parsed.data;
  if (input.decision === "approve" && input.note.trim().length < 5) {
    return adminError("Alasan approval wajib diisi untuk audit override.", 400, "APPROVAL_REASON_REQUIRED");
  }
  const decision = decisionMap[input.decision];
  const db = createServerSupabase();
  const { data: assessmentSnapshot, error: gateError } = await db
    .from("assessments")
    .select("proposal_gate_status, proposal_gate_reasons")
    .eq("id", input.assessmentId)
    .single();
  if (gateError || !assessmentSnapshot) {
    return adminError(gateError?.message || "Assessment tidak ditemukan.", 404, "ASSESSMENT_NOT_FOUND");
  }
  if (input.decision === "approve") {
    const reasons = Array.isArray(assessmentSnapshot.proposal_gate_reasons)
      ? assessmentSnapshot.proposal_gate_reasons as Array<{ code?: unknown }>
      : [];
    const hardBlocks = reasons
      .map((reason) => typeof reason.code === "string" ? reason.code : "")
      .filter((code) => NON_OVERRIDABLE_GATE_REASONS.has(code));
    if (hardBlocks.length > 0) {
      return adminError(
        `Proposal tidak dapat disetujui sebelum masalah katalog/limit diperbaiki: ${hardBlocks.join(", ")}.`,
        409,
        "PROPOSAL_HARD_BLOCKED",
      );
    }
  }
  const decidedAt = new Date().toISOString();
  const { data: approval, error: approvalError } = await db
    .from("proposal_approvals")
    .update({
      status: decision.approval,
      decided_by: admin.email,
      decision_note: input.note || null,
      decided_at: decidedAt,
    })
    .eq("assessment_id", input.assessmentId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (approvalError) return adminError(approvalError.message, 500, "APPROVAL_SAVE_FAILED");
  if (!approval) return adminError("Approval pending tidak ditemukan.", 409, "APPROVAL_NOT_PENDING");

  const { error: assessmentError } = await db.from("assessments").update({
    proposal_gate_status: decision.gate,
    proposal_status: decision.proposal,
    proposal_approved_at: input.decision === "approve" ? decidedAt : null,
    proposal_approved_by: input.decision === "approve" ? admin.email : null,
  }).eq("id", input.assessmentId);
  if (assessmentError) return adminError(assessmentError.message, 500, "ASSESSMENT_GATE_UPDATE_FAILED");

  await logAdminEvent(db, {
    eventType: `proposal_${decision.approval}`,
    targetType: "assessment",
    targetId: input.assessmentId,
    actor: admin.email,
    payload: {
      decision: input.decision,
      reason: input.note,
      before: {
        gateStatus: assessmentSnapshot.proposal_gate_status,
        gateReasons: assessmentSnapshot.proposal_gate_reasons,
      },
      after: {
        gateStatus: decision.gate,
        proposalStatus: decision.proposal,
      },
    },
    status: decision.approval,
    message: `Proposal ${decision.approval} oleh ${admin.email}.`,
  });

  return NextResponse.json({ success: true, gateStatus: decision.gate });
}
