import { NextRequest, NextResponse } from "next/server";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { businessSettingsMutationSchema } from "@/lib/configurable-business-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [
    { data: commercialPolicy, error: commercialError },
    { data: assignments, error: assignmentError },
    { data: delegations, error: delegationError },
    { data: riskSlas, error: riskError },
    { data: documentTemplates, error: templateError },
    { data: modules, error: moduleError },
  ] = await Promise.all([
    db.from("commercial_policy_settings").select("*").eq("setting_key", "default").maybeSingle(),
    db.from("governance_assignments").select("*").order("label"),
    db.from("approval_delegations").select("*").order("label"),
    db.from("risk_sla_policies").select("*").order("final_decision_minutes"),
    db.from("document_templates").select("*").order("document_type").order("updated_at", { ascending: false }),
    db.from("catalog_modules")
      .select("id, module_code, name, active, readiness_status, is_mock")
      .eq("active", true)
      .eq("is_mock", false)
      .order("name"),
  ]);

  const error = commercialError || assignmentError || delegationError || riskError || templateError || moduleError;
  if (error) return adminError(error.message, 500, "BUSINESS_SETTINGS_LOAD_FAILED");

  return NextResponse.json({
    success: true,
    commercialPolicy,
    assignments: assignments || [],
    delegations: delegations || [],
    riskSlas: riskSlas || [],
    documentTemplates: documentTemplates || [],
    modules: modules || [],
  });
}

async function nextVersion(
  db: ReturnType<typeof createServerSupabase>,
  table: string,
  column: string,
  value: string,
) {
  const { data } = await db.from(table).select("version").eq(column, value).maybeSingle();
  return Number(data?.version || 0) + 1;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, businessSettingsMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_BUSINESS_SETTING");
  const input = parsed.data;
  const db = createServerSupabase();

  if (input.action === "save_commercial_policy") {
    const version = await nextVersion(db, "commercial_policy_settings", "setting_key", "default");
    const { data, error } = await db.from("commercial_policy_settings").upsert({
      setting_key: "default",
      minimum_transaction_enabled: input.minimumTransactionEnabled,
      minimum_transaction_amount: input.minimumTransactionAmount,
      below_threshold_action: input.belowThresholdAction,
      route_catalog_module_id: input.belowThresholdAction === "route_to_module"
        ? input.routeCatalogModuleId
        : null,
      currency: input.currency,
      proposal_validity_days: input.proposalValidityDays,
      allow_admin_override: input.allowAdminOverride,
      override_requires_note: input.overrideRequiresNote,
      version,
      updated_by: admin.email,
    }, { onConflict: "setting_key" }).select().single();
    if (error) return adminError(error.message, 500, "COMMERCIAL_POLICY_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: "commercial_policy_updated",
      targetType: "commercial_policy",
      targetId: "default",
      actor: admin.email,
      payload: {
        version,
        minimumTransactionEnabled: data.minimum_transaction_enabled,
        minimumTransactionAmount: data.minimum_transaction_amount,
        belowThresholdAction: data.below_threshold_action,
      },
      status: "Saved",
      message: `Kebijakan komersial versi ${version} disimpan oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, commercialPolicy: data });
  }

  if (input.action === "save_governance_assignment") {
    const version = await nextVersion(db, "governance_assignments", "function_key", input.functionKey);
    const { data, error } = await db.from("governance_assignments").update({
      owner_user_id: input.ownerUserId || null,
      owner_email: input.ownerEmail || null,
      backup_user_id: input.backupUserId || null,
      backup_email: input.backupEmail || null,
      escalation_channel: input.escalationChannel || null,
      notes: input.notes || null,
      active: input.active,
      version,
      updated_by: admin.email,
    }).eq("function_key", input.functionKey).select().single();
    if (error) return adminError(error.message, 500, "GOVERNANCE_ASSIGNMENT_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: "governance_assignment_updated",
      targetType: "governance_assignment",
      targetId: input.functionKey,
      actor: admin.email,
      payload: { version, ownerEmail: input.ownerEmail, backupEmail: input.backupEmail, active: input.active },
      status: "Saved",
      message: `Penanggung jawab ${data.label} diperbarui oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, assignment: data });
  }

  if (input.action === "save_approval_delegation") {
    const version = await nextVersion(db, "approval_delegations", "approval_key", input.approvalKey);
    const { data, error } = await db.from("approval_delegations").update({
      primary_approver_user_id: input.primaryApproverUserId || null,
      primary_approver_email: input.primaryApproverEmail || null,
      delegate_user_id: input.delegateUserId || null,
      delegate_email: input.delegateEmail || null,
      valid_from: input.validFrom || null,
      valid_until: input.validUntil || null,
      maximum_amount: input.maximumAmount ?? null,
      maximum_discount_percent: input.maximumDiscountPercent ?? null,
      conditions: input.conditions || null,
      active: input.active,
      version,
      updated_by: admin.email,
    }).eq("approval_key", input.approvalKey).select().single();
    if (error) return adminError(error.message, 500, "APPROVAL_DELEGATION_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: "approval_delegation_updated",
      targetType: "approval_delegation",
      targetId: input.approvalKey,
      actor: admin.email,
      payload: {
        version,
        primaryApproverEmail: input.primaryApproverEmail,
        delegateEmail: input.delegateEmail,
        active: input.active,
      },
      status: "Saved",
      message: `Aturan approval ${data.label} diperbarui oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, delegation: data });
  }

  if (input.action === "save_risk_sla") {
    const version = await nextVersion(db, "risk_sla_policies", "severity", input.severity);
    const { data, error } = await db.from("risk_sla_policies").update({
      enabled: input.enabled,
      acknowledgment_minutes: input.acknowledgmentMinutes,
      initial_review_minutes: input.initialReviewMinutes,
      backup_escalation_minutes: input.backupEscalationMinutes,
      final_decision_minutes: input.finalDecisionMinutes,
      business_hours_only: input.businessHoursOnly,
      time_zone: input.timeZone,
      escalation_channels: input.escalationChannels,
      owner_email: input.ownerEmail || null,
      notes: input.notes || null,
      version,
      updated_by: admin.email,
    }).eq("severity", input.severity).select().single();
    if (error) return adminError(error.message, 500, "RISK_SLA_SAVE_FAILED");

    await logAdminEvent(db, {
      eventType: "risk_sla_updated",
      targetType: "risk_sla_policy",
      targetId: input.severity,
      actor: admin.email,
      payload: { version, enabled: input.enabled, finalDecisionMinutes: input.finalDecisionMinutes },
      status: "Saved",
      message: `SLA risiko ${data.label} diperbarui oleh ${admin.email}.`,
    });
    return NextResponse.json({ success: true, riskSla: data });
  }

  const isApproved = input.status === "approved";
  const payload = {
    template_key: input.templateKey,
    document_type: input.documentType,
    name: input.name,
    locale: input.locale,
    version: input.version,
    status: input.status,
    body_template: input.bodyTemplate,
    variables: input.variables,
    review_required: input.reviewRequired,
    owner_email: input.ownerEmail || null,
    approved_by: isApproved ? admin.email : null,
    approved_at: isApproved ? new Date().toISOString() : null,
    approval_note: isApproved ? input.approvalNote : null,
    updated_by: admin.email,
    ...(!input.id ? { created_by: admin.email } : {}),
  };
  const query = input.id
    ? db.from("document_templates").update(payload).eq("id", input.id).select().single()
    : db.from("document_templates").insert(payload).select().single();
  const { data, error } = await query;
  if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "DOCUMENT_TEMPLATE_SAVE_FAILED");

  await logAdminEvent(db, {
    eventType: isApproved ? "document_template_approved" : "document_template_saved",
    targetType: "document_template",
    targetId: data.id,
    actor: admin.email,
    payload: {
      templateKey: input.templateKey,
      documentType: input.documentType,
      version: input.version,
      status: input.status,
    },
    status: "Saved",
    message: `Template ${input.name} disimpan sebagai ${input.status} oleh ${admin.email}.`,
  });
  return NextResponse.json({ success: true, documentTemplate: data });
}
