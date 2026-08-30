import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { operationalAssuranceMutationSchema } from "@/lib/admin-mutation-schemas";
import { WORKFLOW_ENVIRONMENT_DRY_RUN, runOperationalAssuranceScan } from "@/lib/operational-assurance-scan";
import type { AssuredWorkflowKey } from "@/lib/operational-assurance";
import { createServerSupabase } from "@/lib/supabase";

function missingPhase11(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || error.message?.includes("does not exist")));
}

function mapPolicy(item: Record<string, unknown>) {
  const workflowKey = item.workflow_key as AssuredWorkflowKey;
  return {
    workflowKey,
    lookbackHours: item.lookback_hours,
    minimumRuns: item.minimum_runs,
    maximumFailureRatePercent: Number(item.maximum_failure_rate_percent),
    staleRunningMinutes: item.stale_running_minutes,
    maximumConsecutiveFailures: item.maximum_consecutive_failures,
    enabled: item.enabled,
    owner: item.owner,
    isMock: item.is_mock,
    version: item.version,
    updatedBy: item.updated_by,
    updatedAt: item.updated_at,
    environmentDryRun: WORKFLOW_ENVIRONMENT_DRY_RUN[workflowKey]?.() ?? true,
  };
}

function mapSnapshot(item: Record<string, unknown>) {
  return {
    id: item.id,
    pilotReleaseId: item.pilot_release_id,
    idempotencyKey: item.idempotency_key,
    windowStartedAt: item.window_started_at,
    windowEndedAt: item.window_ended_at,
    evaluatedAt: item.evaluated_at,
    overallStatus: item.overall_status,
    metrics: item.metrics || {},
    findings: Array.isArray(item.findings) ? item.findings : [],
    blockers: Array.isArray(item.blockers) ? item.blockers : [],
    dryRun: item.dry_run,
    isMock: item.is_mock,
    createdBy: item.created_by,
    createdAt: item.created_at,
  };
}

function mapIncident(item: Record<string, unknown>) {
  return {
    id: item.id,
    incidentKey: item.incident_key,
    workflowKey: item.workflow_key,
    pilotReleaseId: item.pilot_release_id,
    severity: item.severity,
    status: item.status,
    sourceType: item.source_type,
    sourceRunId: item.source_run_id,
    title: item.title,
    summary: item.summary,
    owner: item.owner,
    resolutionNote: item.resolution_note,
    detectedAt: item.detected_at,
    lastDetectedAt: item.last_detected_at,
    occurrenceCount: item.occurrence_count,
    resolvedAt: item.resolved_at,
    resolvedBy: item.resolved_by,
    updatedBy: item.updated_by,
    updatedAt: item.updated_at,
  };
}

function mapReview(item: Record<string, unknown>) {
  return {
    id: item.id,
    pilotReleaseId: item.pilot_release_id,
    monitoringSnapshotId: item.monitoring_snapshot_id,
    decision: item.decision,
    conditions: Array.isArray(item.conditions) ? item.conditions : [],
    decisionNote: item.decision_note,
    decidedBy: item.decided_by,
    decidedAt: item.decided_at,
    version: item.version,
    updatedAt: item.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [policies, policyEvents, snapshots, incidents, incidentEvents, reviews, releases, controls] = await Promise.all([
    db.from("automation_monitoring_policies")
      .select("workflow_key, lookback_hours, minimum_runs, maximum_failure_rate_percent, stale_running_minutes, maximum_consecutive_failures, enabled, owner, is_mock, version, updated_by, updated_at")
      .order("workflow_key"),
    db.from("automation_monitoring_policy_events")
      .select("id, workflow_key, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    db.from("pilot_monitoring_snapshots")
      .select("id, pilot_release_id, idempotency_key, window_started_at, window_ended_at, evaluated_at, overall_status, metrics, findings, blockers, dry_run, is_mock, created_by, created_at")
      .order("evaluated_at", { ascending: false })
      .limit(100),
    db.from("automation_incidents")
      .select("id, incident_key, workflow_key, pilot_release_id, severity, status, source_type, source_run_id, title, summary, owner, resolution_note, detected_at, last_detected_at, occurrence_count, resolved_at, resolved_by, updated_by, updated_at")
      .order("last_detected_at", { ascending: false })
      .limit(300),
    db.from("automation_incident_events")
      .select("id, incident_id, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("pilot_go_no_go_reviews")
      .select("id, pilot_release_id, monitoring_snapshot_id, decision, conditions, decision_note, decided_by, decided_at, version, updated_at")
      .order("decided_at", { ascending: false }),
    db.from("pilot_release_plans")
      .select("id, release_key, title, status, monitoring_owner, is_mock, updated_at")
      .order("updated_at", { ascending: false }),
    db.from("automation_runtime_controls")
      .select("workflow_key, requested_mode, pilot_release_id, owner, version, updated_at")
      .order("workflow_key"),
  ]);

  const phase11Error = policies.error || policyEvents.error || snapshots.error || incidents.error || incidentEvents.error || reviews.error;
  if (missingPhase11(phase11Error)) {
    return NextResponse.json({
      success: true,
      phase11Ready: false,
      activationLocked: true,
      state: "migration_required",
      policies: [],
      policyEvents: [],
      snapshots: [],
      incidents: [],
      incidentEvents: [],
      reviews: [],
      releases: [],
      controls: [],
    });
  }
  const queryError = phase11Error || releases.error || controls.error;
  if (queryError) return adminError(queryError.message, 500, "OPERATIONAL_ASSURANCE_LOAD_FAILED");

  const mappedPolicies = (policies.data || []).map((item) => mapPolicy(item as Record<string, unknown>));
  const mappedSnapshots = (snapshots.data || []).map((item) => mapSnapshot(item as Record<string, unknown>));
  const mappedIncidents = (incidents.data || []).map((item) => mapIncident(item as Record<string, unknown>));
  const mappedReviews = (reviews.data || []).map((item) => mapReview(item as Record<string, unknown>));
  const mappedReleases = (releases.data || []).map((item) => ({
    id: item.id,
    releaseKey: item.release_key,
    title: item.title,
    status: item.status,
    monitoringOwner: item.monitoring_owner,
    isMock: item.is_mock,
    updatedAt: item.updated_at,
  }));
  const activeRelease = mappedReleases.find((item) => ["approved", "scheduled"].includes(item.status) && !item.isMock) || null;
  const latestSnapshot = mappedSnapshots.find((item) => item.pilotReleaseId === activeRelease?.id) || null;
  const activeReview = mappedReviews.find((item) => item.pilotReleaseId === activeRelease?.id) || null;
  const openIncidents = mappedIncidents.filter((item) => !["resolved", "dismissed"].includes(String(item.status)));
  const releaseIncidents = openIncidents.filter((item) => !item.pilotReleaseId || item.pilotReleaseId === activeRelease?.id);
  const criticalIncidents = releaseIncidents.filter((item) => item.severity === "critical");
  const policiesReady = mappedPolicies.length === 4
    && mappedPolicies.every((item) => item.enabled && !item.isMock && item.owner);

  let state = "release_required";
  if (activeRelease && !policiesReady) state = "policy_configuration_required";
  else if (activeRelease && !latestSnapshot) state = "snapshot_required";
  else if (activeRelease && latestSnapshot?.isMock) state = "real_snapshot_required";
  else if (activeRelease && criticalIncidents.length) state = "incident_blocked";
  else if (activeRelease && ["critical", "insufficient_data"].includes(String(latestSnapshot?.overallStatus))) state = "monitoring_blocked";
  else if (activeRelease && activeReview && ["go", "conditional_go"].includes(String(activeReview.decision))) state = "operationally_approved";
  else if (activeRelease) state = "eligible_for_human_review";

  return NextResponse.json({
    success: true,
    phase11Ready: true,
    generatedAt: new Date().toISOString(),
    activationLocked: true,
    externalActivationRequired: true,
    state,
    summary: {
      activeReleaseId: activeRelease?.id || null,
      policiesReady,
      policyCount: mappedPolicies.length,
      mockPolicyCount: mappedPolicies.filter((item) => item.isMock).length,
      openIncidentCount: openIncidents.length,
      criticalIncidentCount: criticalIncidents.length,
      latestSnapshotStatus: latestSnapshot?.overallStatus || null,
      latestSnapshotAt: latestSnapshot?.evaluatedAt || null,
      activeDecision: activeReview?.decision || null,
    },
    policies: mappedPolicies,
    policyEvents: (policyEvents.data || []).map((item) => ({
      id: item.id,
      workflowKey: item.workflow_key,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
    snapshots: mappedSnapshots,
    incidents: mappedIncidents,
    incidentEvents: (incidentEvents.data || []).map((item) => ({
      id: item.id,
      incidentId: item.incident_id,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
    reviews: mappedReviews,
    releases: mappedReleases,
    controls: (controls.data || []).map((item) => ({
      workflowKey: item.workflow_key,
      requestedMode: item.requested_mode,
      environmentDryRun: WORKFLOW_ENVIRONMENT_DRY_RUN[item.workflow_key as AssuredWorkflowKey]?.() ?? true,
      pilotReleaseId: item.pilot_release_id,
      owner: item.owner,
      version: item.version,
      updatedAt: item.updated_at,
    })),
  });
}

function knownMutationError(message: string) {
  const errors: Array<[string, string, number]> = [
    ["PHASE11_MIGRATION_REQUIRED", "Migration Fase 11 belum diterapkan.", 409],
    ["MONITORING_POLICY_NOT_FOUND", "Policy monitoring tidak ditemukan.", 404],
    ["MONITORING_THRESHOLD_INVALID", "Threshold monitoring berada di luar batas aman.", 400],
    ["MONITORING_OWNER_REQUIRED", "Policy real wajib memiliki owner.", 400],
    ["INCIDENT_NOT_FOUND", "Incident tidak ditemukan.", 404],
    ["INCIDENT_OWNER_REQUIRED", "Owner wajib untuk incident yang sedang ditangani atau ditutup.", 400],
    ["INCIDENT_RESOLUTION_REQUIRED", "Catatan penyelesaian incident minimal 10 karakter.", 400],
    ["PILOT_RELEASE_NOT_FOUND", "Rencana pilot tidak ditemukan.", 404],
    ["GO_NO_GO_APPROVED_RELEASE_REQUIRED", "Go/no-go hanya dapat dicatat untuk release approved non-mock.", 409],
    ["GO_NO_GO_SNAPSHOT_INVALID", "Snapshot monitoring tidak terikat pada release yang dipilih.", 409],
    ["GO_NO_GO_FRESH_REAL_SNAPSHOT_REQUIRED", "Gunakan snapshot real yang berusia kurang dari 24 jam.", 409],
    ["GO_NO_GO_REAL_POLICIES_REQUIRED", "Keempat policy wajib aktif, non-mock, dan memiliki owner.", 409],
    ["GO_NO_GO_UAT_INCOMPLETE", "Skenario UAT wajib belum seluruhnya lulus.", 409],
    ["GO_NO_GO_CRITICAL_INCIDENT_OPEN", "Critical incident harus diselesaikan sebelum keputusan go.", 409],
    ["GO_NO_GO_HIGH_INCIDENT_OPEN", "High atau critical incident harus diselesaikan sebelum keputusan go penuh.", 409],
    ["GO_NO_GO_HEALTHY_SNAPSHOT_REQUIRED", "Keputusan go membutuhkan snapshot healthy tanpa blocker.", 409],
    ["GO_NO_GO_CONDITIONAL_SNAPSHOT_INVALID", "Conditional go tidak dapat digunakan pada snapshot critical atau tanpa bukti.", 409],
    ["GO_NO_GO_ACCEPTANCE_REQUIRED", "Selesaikan sertifikasi penerimaan Fase 12 pada snapshot yang sama sebelum keputusan go/no-go.", 409],
  ];
  return errors.find(([code]) => message.includes(code));
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, operationalAssuranceMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_OPERATIONAL_ASSURANCE_MUTATION");

  const db = createServerSupabase();
  const input = parsed.data;
  try {
    if (input.action === "run_scan") {
      const scan = await runOperationalAssuranceScan({
        db,
        actor: admin.email,
        releaseId: input.releaseId || null,
        materializeIncidents: input.materializeIncidents,
      });
      return NextResponse.json({
        success: true,
        activationLocked: true,
        outboundTriggered: false,
        scan,
      });
    }

    let result;
    if (input.action === "save_policy") {
      result = await db.rpc("save_automation_monitoring_policy", {
        p_workflow_key: input.workflowKey,
        p_actor: admin.email,
        p_lookback_hours: input.lookbackHours,
        p_minimum_runs: input.minimumRuns,
        p_maximum_failure_rate_percent: input.maximumFailureRatePercent,
        p_stale_running_minutes: input.staleRunningMinutes,
        p_maximum_consecutive_failures: input.maximumConsecutiveFailures,
        p_enabled: input.enabled,
        p_owner: input.owner || null,
        p_is_mock: input.isMock,
      });
    } else if (input.action === "update_incident") {
      result = await db.rpc("update_automation_incident", {
        p_incident_id: input.incidentId,
        p_actor: admin.email,
        p_status: input.status,
        p_severity: input.severity,
        p_owner: input.owner || null,
        p_resolution_note: input.resolutionNote || null,
      });
    } else {
      result = await db.rpc("record_pilot_go_no_go_review", {
        p_release_id: input.releaseId,
        p_snapshot_id: input.snapshotId,
        p_actor: admin.email,
        p_decision: input.decision,
        p_conditions: input.conditions,
        p_decision_note: input.decisionNote,
      });
    }

    if (result.error) {
      const known = knownMutationError(result.error.message);
      if (known) return adminError(known[1], known[2], known[0]);
      if (missingPhase11(result.error)) return adminError("Migration Fase 11 belum diterapkan.", 409, "PHASE11_MIGRATION_REQUIRED");
      return adminError(result.error.message, 500, "OPERATIONAL_ASSURANCE_MUTATION_FAILED");
    }
    return NextResponse.json({ success: true, activationLocked: true, outboundTriggered: false, result: result.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Operational Assurance gagal dijalankan.";
    const known = knownMutationError(message);
    if (known) return adminError(known[1], known[2], known[0]);
    return adminError(message, 500, "OPERATIONAL_ASSURANCE_SCAN_FAILED");
  }
}
