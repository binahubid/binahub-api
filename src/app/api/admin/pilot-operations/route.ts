import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { pilotOperationsMutationSchema } from "@/lib/admin-mutation-schemas";
import { resolveEffectiveAutomationMode, type AutomationRequestedMode } from "@/lib/automation-runtime-control";
import { createServerSupabase } from "@/lib/supabase";

type RuntimeRow = {
  workflow_key: string;
  requested_mode: AutomationRequestedMode;
  maximum_items_per_run: number;
  pilot_release_id: string | null;
  owner: string | null;
  approval_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rollback_plan: string | null;
  kill_switch_reason: string | null;
  version: number;
  updated_by: string | null;
  updated_at: string;
};

type ReleaseRow = {
  id: string;
  release_key: string;
  title: string;
  status: string;
  cohort_description: string;
  maximum_participants: number;
  starts_at: string | null;
  ends_at: string | null;
  business_owner: string | null;
  technical_owner: string | null;
  monitoring_owner: string | null;
  success_criteria: unknown;
  rollback_triggers: unknown;
  rollback_plan: string | null;
  decision_note: string | null;
  approved_by: string | null;
  approved_at: string | null;
  is_mock: boolean;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

const environmentDryRun: Record<string, boolean> = {
  follow_up_scheduler: process.env.FOLLOW_UP_DRY_RUN !== "false",
  transformation_event_worker: process.env.TRANSFORMATION_WORKER_DRY_RUN !== "false",
  client_operations_daily: process.env.OPERATIONS_DRY_RUN !== "false",
  acquisition_batch_processor: process.env.ACQUISITION_DRY_RUN !== "false",
};

function mapRelease(item: ReleaseRow) {
  return {
    id: item.id,
    releaseKey: item.release_key,
    title: item.title,
    status: item.status,
    cohortDescription: item.cohort_description,
    maximumParticipants: item.maximum_participants,
    startsAt: item.starts_at,
    endsAt: item.ends_at,
    businessOwner: item.business_owner,
    technicalOwner: item.technical_owner,
    monitoringOwner: item.monitoring_owner,
    successCriteria: Array.isArray(item.success_criteria) ? item.success_criteria : [],
    rollbackTriggers: Array.isArray(item.rollback_triggers) ? item.rollback_triggers : [],
    rollbackPlan: item.rollback_plan,
    decisionNote: item.decision_note,
    approvedBy: item.approved_by,
    approvedAt: item.approved_at,
    isMock: item.is_mock,
    createdBy: item.created_by,
    updatedBy: item.updated_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

function mapRuntime(item: RuntimeRow) {
  const envDryRun = environmentDryRun[item.workflow_key] ?? true;
  return {
    workflowKey: item.workflow_key,
    requestedMode: item.requested_mode,
    effectiveMode: resolveEffectiveAutomationMode(item.requested_mode, envDryRun),
    environmentDryRun: envDryRun,
    maximumItemsPerRun: item.maximum_items_per_run,
    pilotReleaseId: item.pilot_release_id,
    owner: item.owner,
    approvalNote: item.approval_note,
    approvedBy: item.approved_by,
    approvedAt: item.approved_at,
    rollbackPlan: item.rollback_plan,
    killSwitchReason: item.kill_switch_reason,
    version: item.version,
    updatedBy: item.updated_by,
    updatedAt: item.updated_at,
  };
}

function isMissingPhase10(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || error.message?.includes("does not exist")));
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [releases, releaseEvents, controls, controlEvents, uat, templates, rules] = await Promise.all([
    db.from("pilot_release_plans")
      .select("id, release_key, title, status, cohort_description, maximum_participants, starts_at, ends_at, business_owner, technical_owner, monitoring_owner, success_criteria, rollback_triggers, rollback_plan, decision_note, approved_by, approved_at, is_mock, created_by, updated_by, created_at, updated_at")
      .order("created_at", { ascending: false }),
    db.from("pilot_release_events")
      .select("id, release_id, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("automation_runtime_controls")
      .select("workflow_key, requested_mode, maximum_items_per_run, pilot_release_id, owner, approval_note, approved_by, approved_at, rollback_plan, kill_switch_reason, version, updated_by, updated_at")
      .order("workflow_key", { ascending: true }),
    db.from("automation_runtime_control_events")
      .select("id, workflow_key, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("uat_scenarios").select("required, status"),
    db.from("outreach_templates").select("template_key, locale, status, is_mock"),
    db.from("business_rule_sets")
      .select("id, version, status, is_mock, rules, updated_at")
      .eq("status", "active")
      .eq("is_mock", false)
      .order("updated_at", { ascending: false })
      .limit(1),
  ]);

  const phase10QueryError = releases.error || releaseEvents.error || controls.error || controlEvents.error;
  if (isMissingPhase10(phase10QueryError)) {
    return NextResponse.json({
      success: true,
      phase10Ready: false,
      activationLocked: true,
      externalActivationRequired: true,
      state: "migration_required",
      releases: [],
      releaseEvents: [],
      controls: [],
      controlEvents: [],
    });
  }
  const queryError = phase10QueryError || uat.error || templates.error || rules.error;
  if (queryError) return adminError(queryError.message, 500, "PILOT_OPERATIONS_LOAD_FAILED");

  const requiredUat = (uat.data || []).filter((item) => item.required);
  const passedUat = requiredUat.filter((item) => item.status === "passed");
  const approvedTemplateKeys = new Set(
    (templates.data || [])
      .filter((item) => item.status === "approved" && item.is_mock === false)
      .map((item) => `${item.template_key}:${item.locale}`),
  );
  const activeRule = (rules.data || [])[0] || null;
  const activeRuleDocument = activeRule?.rules && typeof activeRule.rules === "object"
    ? activeRule.rules as Record<string, unknown>
    : {};
  const activation = activeRuleDocument.activation && typeof activeRuleDocument.activation === "object"
    ? activeRuleDocument.activation as Record<string, unknown>
    : {};
  const businessRulesReady = Boolean(
    activeRule
    && activation.outboundAutomationEnabled === true
    && Array.isArray(activation.blockers)
    && activation.blockers.length === 0,
  );
  const uatReady = requiredUat.length >= 12 && passedUat.length === requiredUat.length;
  const templatesReady = approvedTemplateKeys.size >= 18;
  const mappedReleases = ((releases.data || []) as ReleaseRow[]).map(mapRelease);
  const approvedReleaseCount = mappedReleases.filter((item) => ["approved", "scheduled"].includes(item.status) && !item.isMock).length;
  const gatesReady = uatReady && templatesReady && businessRulesReady;

  return NextResponse.json({
    success: true,
    phase10Ready: true,
    generatedAt: new Date().toISOString(),
    activationLocked: true,
    externalActivationRequired: true,
    state: gatesReady ? "eligible_for_pilot_review" : "construction_locked",
    gates: {
      uat: { ready: uatReady, required: requiredUat.length, passed: passedUat.length },
      templates: { ready: templatesReady, approvedNonMock: approvedTemplateKeys.size, required: 18 },
      businessRules: {
        ready: businessRulesReady,
        activeVersion: activeRule?.version || null,
        outboundAutomationEnabled: activation.outboundAutomationEnabled === true,
        blockerCount: Array.isArray(activation.blockers) ? activation.blockers.length : null,
      },
      approvedRelease: { ready: approvedReleaseCount > 0, count: approvedReleaseCount },
    },
    releases: mappedReleases,
    releaseEvents: (releaseEvents.data || []).map((item) => ({
      id: item.id,
      releaseId: item.release_id,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
    controls: ((controls.data || []) as RuntimeRow[]).map(mapRuntime),
    controlEvents: (controlEvents.data || []).map((item) => ({
      id: item.id,
      workflowKey: item.workflow_key,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
  });
}

function knownMutationError(message: string) {
  const errors: Array<[string, string, number]> = [
    ["PILOT_RELEASE_NOT_FOUND", "Rencana pilot tidak ditemukan.", 404],
    ["PILOT_RELEASE_KEY_INVALID", "Release key pilot tidak valid.", 400],
    ["PILOT_PLAN_DESCRIPTION_REQUIRED", "Judul dan deskripsi cohort wajib dilengkapi.", 400],
    ["PILOT_DATE_RANGE_INVALID", "Waktu selesai harus setelah waktu mulai.", 400],
    ["PILOT_RELEASE_LOCKED_FOR_EDIT", "Rencana hanya dapat diedit ketika draft atau rejected.", 409],
    ["PILOT_STATUS_TRANSITION_INVALID", "Perubahan status rencana pilot tidak valid.", 409],
    ["PILOT_DECISION_NOTE_REQUIRED", "Catatan keputusan minimal 10 karakter.", 400],
    ["PILOT_PLAN_INCOMPLETE", "Owner, kriteria sukses, rollback trigger, dan rollback plan harus lengkap serta bukan mock.", 409],
    ["PILOT_UAT_INCOMPLETE", "Skenario UAT wajib belum seluruhnya lulus.", 409],
    ["PILOT_TEMPLATES_INCOMPLETE", "Template outreach approved non-mock belum lengkap.", 409],
    ["PILOT_BUSINESS_RULES_INCOMPLETE", "Business Rules belum membuka outbound atau masih memiliki blocker.", 409],
    ["PILOT_RUNTIME_CONTROLS_ACTIVE", "Kembalikan seluruh runtime control release ini ke dry-run atau disabled sebelum pause, rollback, atau selesai.", 409],
    ["PILOT_OPERATIONAL_REVIEW_REQUIRED", "Jadwal pilot membutuhkan keputusan go atau conditional go dari Operational Assurance.", 409],
    ["PILOT_MONITORING_POLICY_NOT_READY", "Keempat policy monitoring wajib aktif, non-mock, dan memiliki owner sebelum penjadwalan.", 409],
    ["PILOT_CRITICAL_INCIDENT_OPEN", "Critical incident harus diselesaikan sebelum release dijadwalkan.", 409],
    ["PILOT_HIGH_INCIDENT_OPEN", "High incident harus diselesaikan atau keputusan diubah menjadi conditional go sebelum penjadwalan.", 409],
    ["PILOT_ACCEPTANCE_CERTIFICATION_REQUIRED", "Release membutuhkan sertifikasi penerimaan Fase 12 sebelum dijadwalkan.", 409],
    ["RUNTIME_CONTROL_NOT_FOUND", "Runtime control tidak ditemukan.", 404],
    ["RUNTIME_HUMAN_APPROVAL_REQUIRED", "Mode pilot/live membutuhkan approval manusia, owner, release, catatan, dan rollback plan.", 409],
    ["RUNTIME_APPROVED_RELEASE_REQUIRED", "Mode pilot/live membutuhkan release non-mock yang approved atau scheduled.", 409],
    ["RUNTIME_SCHEDULED_RELEASE_REQUIRED", "Mode live membutuhkan release berstatus scheduled.", 409],
    ["RUNTIME_KILL_REASON_REQUIRED", "Alasan kill switch minimal 5 karakter.", 400],
    ["RUNTIME_OPERATIONAL_REVIEW_REQUIRED", "Mode pilot membutuhkan keputusan go atau conditional go yang masih valid.", 409],
    ["RUNTIME_GO_DECISION_REQUIRED", "Mode live hanya dapat diminta setelah keputusan go penuh.", 409],
    ["RUNTIME_MONITORING_POLICY_NOT_READY", "Policy monitoring belum siap untuk mode pilot atau live.", 409],
    ["RUNTIME_UAT_INCOMPLETE", "Skenario UAT wajib belum seluruhnya lulus.", 409],
    ["RUNTIME_CRITICAL_INCIDENT_OPEN", "Critical incident harus diselesaikan sebelum mode pilot atau live.", 409],
    ["RUNTIME_HIGH_INCIDENT_OPEN", "High incident harus diselesaikan sebelum mode live.", 409],
    ["RUNTIME_ACCEPTANCE_CERTIFICATION_REQUIRED", "Mode pilot/live membutuhkan sertifikasi penerimaan Fase 12 yang valid.", 409],
  ];
  return errors.find(([code]) => message.includes(code));
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, pilotOperationsMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_PILOT_OPERATION");

  const db = createServerSupabase();
  const input = parsed.data;
  let result;
  if (input.action === "save_plan") {
    result = await db.rpc("save_pilot_release_plan", {
      p_release_id: input.releaseId || null,
      p_actor: admin.email,
      p_release_key: input.releaseKey,
      p_title: input.title,
      p_cohort_description: input.cohortDescription,
      p_maximum_participants: input.maximumParticipants,
      p_starts_at: input.startsAt || null,
      p_ends_at: input.endsAt || null,
      p_business_owner: input.businessOwner || null,
      p_technical_owner: input.technicalOwner || null,
      p_monitoring_owner: input.monitoringOwner || null,
      p_success_criteria: input.successCriteria,
      p_rollback_triggers: input.rollbackTriggers,
      p_rollback_plan: input.rollbackPlan || null,
      p_is_mock: input.isMock,
    });
  } else if (input.action === "transition_plan") {
    result = await db.rpc("transition_pilot_release_plan", {
      p_release_id: input.releaseId,
      p_actor: admin.email,
      p_next_status: input.nextStatus,
      p_decision_note: input.decisionNote,
    });
  } else {
    result = await db.rpc("set_automation_runtime_control", {
      p_workflow_key: input.workflowKey,
      p_actor: admin.email,
      p_requested_mode: input.requestedMode,
      p_maximum_items_per_run: input.maximumItemsPerRun,
      p_owner: input.owner || null,
      p_release_id: input.releaseId || null,
      p_human_approved: input.humanApproved,
      p_approval_note: input.approvalNote || null,
      p_rollback_plan: input.rollbackPlan || null,
      p_kill_switch_reason: input.killSwitchReason || null,
    });
  }

  if (result.error) {
    const known = knownMutationError(result.error.message);
    if (known) return adminError(known[1], known[2], known[0]);
    if (isMissingPhase10(result.error)) return adminError("Migration Fase 10 belum diterapkan.", 409, "PHASE10_MIGRATION_REQUIRED");
    return adminError(result.error.message, 500, "PILOT_OPERATION_FAILED");
  }

  return NextResponse.json({
    success: true,
    activationLocked: true,
    externalActivationRequired: true,
    result: result.data,
  });
}
