import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { pilotCertificationMutationSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

function missingPhase12(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || error.message?.includes("does not exist")));
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [rehearsals, steps, rehearsalEvents, certifications, certificationEvents, releases, snapshots, scenarios, policies, incidents] = await Promise.all([
    db.from("pilot_rehearsals")
      .select("id, rehearsal_key, pilot_release_id, monitoring_snapshot_id, title, environment, status, owner, approver, summary, rollback_result, failure_reason, dry_run, is_mock, started_at, finished_at, created_by, updated_by, created_at, updated_at")
      .order("created_at", { ascending: false }),
    db.from("pilot_rehearsal_steps")
      .select("id, rehearsal_id, step_key, title, description, expected_result, sort_order, required, status, owner, evidence_note, evidence_url, actual_result, blocker_reason, last_tested_at, last_tested_by, updated_by, updated_at")
      .order("sort_order", { ascending: true }),
    db.from("pilot_rehearsal_events")
      .select("id, rehearsal_id, step_id, event_type, actor, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    db.from("pilot_acceptance_certifications")
      .select("id, pilot_release_id, rehearsal_id, monitoring_snapshot_id, decision, conditions, decision_note, uat_evidence_snapshot, decided_by, decided_at, is_mock, version, updated_at")
      .order("decided_at", { ascending: false }),
    db.from("pilot_acceptance_events")
      .select("id, certification_id, pilot_release_id, event_type, actor, note, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    db.from("pilot_release_plans")
      .select("id, release_key, title, status, is_mock, monitoring_owner, updated_at")
      .order("updated_at", { ascending: false }),
    db.from("pilot_monitoring_snapshots")
      .select("id, pilot_release_id, overall_status, blockers, dry_run, is_mock, evaluated_at")
      .order("evaluated_at", { ascending: false })
      .limit(100),
    db.from("uat_scenarios")
      .select("id, scenario_key, required, status, owner, evidence_note, actual_result, last_tested_at"),
    db.from("automation_monitoring_policies")
      .select("workflow_key, enabled, owner, is_mock"),
    db.from("automation_incidents")
      .select("id, pilot_release_id, status, severity"),
  ]);

  const phase12Error = rehearsals.error || steps.error || rehearsalEvents.error || certifications.error || certificationEvents.error;
  if (missingPhase12(phase12Error)) {
    return NextResponse.json({
      success: true,
      phase12Ready: false,
      activationLocked: true,
      state: "migration_required",
      rehearsals: [],
      steps: [],
      rehearsalEvents: [],
      certifications: [],
      certificationEvents: [],
      releases: [],
      snapshots: [],
    });
  }
  const queryError = phase12Error || releases.error || snapshots.error || scenarios.error || policies.error || incidents.error;
  if (queryError) return adminError(queryError.message, 500, "PILOT_CERTIFICATION_LOAD_FAILED");

  const mappedReleases = (releases.data || []).map((item) => ({
    id: item.id,
    releaseKey: item.release_key,
    title: item.title,
    status: item.status,
    isMock: item.is_mock,
    monitoringOwner: item.monitoring_owner,
    updatedAt: item.updated_at,
  }));
  const activeRelease = mappedReleases.find((item) => ["approved", "scheduled"].includes(item.status) && !item.isMock) || null;
  const requiredScenarios = (scenarios.data || []).filter((item) => item.required);
  const passedScenarios = requiredScenarios.filter((item) => item.status === "passed" && item.owner && item.evidence_note && item.actual_result);
  const policiesReady = (policies.data || []).length === 4
    && (policies.data || []).every((item) => item.enabled && !item.is_mock && item.owner);
  const openCriticalCount = (incidents.data || []).filter((item) => (
    !["resolved", "dismissed"].includes(item.status)
    && item.severity === "critical"
    && (!item.pilot_release_id || item.pilot_release_id === activeRelease?.id)
  )).length;
  const activeCertification = (certifications.data || []).find((item) => item.pilot_release_id === activeRelease?.id) || null;
  const activeRehearsal = (rehearsals.data || []).find((item) => item.pilot_release_id === activeRelease?.id) || null;

  let state = "release_required";
  if (activeRelease && passedScenarios.length !== requiredScenarios.length) state = "uat_incomplete";
  else if (activeRelease && !policiesReady) state = "monitoring_policy_incomplete";
  else if (activeRelease && !activeRehearsal) state = "rehearsal_required";
  else if (activeRelease && activeRehearsal?.status !== "passed") state = "rehearsal_incomplete";
  else if (activeRelease && openCriticalCount) state = "incident_blocked";
  else if (activeRelease && !activeCertification) state = "eligible_for_certification";
  else if (activeRelease && activeCertification?.decision === "rejected") state = "certification_rejected";
  else if (activeRelease) state = "certified_for_go_no_go";

  return NextResponse.json({
    success: true,
    phase12Ready: true,
    generatedAt: new Date().toISOString(),
    activationLocked: true,
    outboundTriggered: false,
    externalActivationRequired: true,
    state,
    summary: {
      activeReleaseId: activeRelease?.id || null,
      requiredUatCount: requiredScenarios.length,
      passedUatCount: passedScenarios.length,
      policiesReady,
      openCriticalCount,
      activeRehearsalId: activeRehearsal?.id || null,
      activeRehearsalStatus: activeRehearsal?.status || null,
      activeCertificationDecision: activeCertification?.decision || null,
    },
    rehearsals: (rehearsals.data || []).map((item) => ({
      id: item.id,
      rehearsalKey: item.rehearsal_key,
      pilotReleaseId: item.pilot_release_id,
      monitoringSnapshotId: item.monitoring_snapshot_id,
      title: item.title,
      environment: item.environment,
      status: item.status,
      owner: item.owner,
      approver: item.approver,
      summary: item.summary,
      rollbackResult: item.rollback_result,
      failureReason: item.failure_reason,
      dryRun: item.dry_run,
      isMock: item.is_mock,
      startedAt: item.started_at,
      finishedAt: item.finished_at,
      createdBy: item.created_by,
      updatedBy: item.updated_by,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    })),
    steps: (steps.data || []).map((item) => ({
      id: item.id,
      rehearsalId: item.rehearsal_id,
      stepKey: item.step_key,
      title: item.title,
      description: item.description,
      expectedResult: item.expected_result,
      sortOrder: item.sort_order,
      required: item.required,
      status: item.status,
      owner: item.owner,
      evidenceNote: item.evidence_note,
      evidenceUrl: item.evidence_url,
      actualResult: item.actual_result,
      blockerReason: item.blocker_reason,
      lastTestedAt: item.last_tested_at,
      lastTestedBy: item.last_tested_by,
      updatedBy: item.updated_by,
      updatedAt: item.updated_at,
    })),
    rehearsalEvents: (rehearsalEvents.data || []).map((item) => ({
      id: item.id,
      rehearsalId: item.rehearsal_id,
      stepId: item.step_id,
      eventType: item.event_type,
      actor: item.actor,
      note: item.note,
      createdAt: item.created_at,
    })),
    certifications: (certifications.data || []).map((item) => ({
      id: item.id,
      pilotReleaseId: item.pilot_release_id,
      rehearsalId: item.rehearsal_id,
      monitoringSnapshotId: item.monitoring_snapshot_id,
      decision: item.decision,
      conditions: Array.isArray(item.conditions) ? item.conditions : [],
      decisionNote: item.decision_note,
      uatEvidenceSnapshot: item.uat_evidence_snapshot,
      decidedBy: item.decided_by,
      decidedAt: item.decided_at,
      isMock: item.is_mock,
      version: item.version,
      updatedAt: item.updated_at,
    })),
    certificationEvents: (certificationEvents.data || []).map((item) => ({
      id: item.id,
      certificationId: item.certification_id,
      pilotReleaseId: item.pilot_release_id,
      eventType: item.event_type,
      actor: item.actor,
      note: item.note,
      createdAt: item.created_at,
    })),
    releases: mappedReleases,
    snapshots: (snapshots.data || []).map((item) => ({
      id: item.id,
      pilotReleaseId: item.pilot_release_id,
      overallStatus: item.overall_status,
      blockers: Array.isArray(item.blockers) ? item.blockers : [],
      dryRun: item.dry_run,
      isMock: item.is_mock,
      evaluatedAt: item.evaluated_at,
    })),
  });
}

function knownMutationError(message: string) {
  const errors: Array<[string, string, number]> = [
    ["PHASE12_MIGRATION_REQUIRED", "Migration Fase 12 belum diterapkan.", 409],
    ["PILOT_RELEASE_NOT_FOUND", "Release pilot tidak ditemukan.", 404],
    ["REHEARSAL_NOT_FOUND", "Rehearsal tidak ditemukan.", 404],
    ["REHEARSAL_STEP_NOT_FOUND", "Langkah rehearsal tidak ditemukan.", 404],
    ["REHEARSAL_APPROVED_RELEASE_REQUIRED", "Rehearsal real membutuhkan release approved non-mock.", 409],
    ["REHEARSAL_OWNERS_REQUIRED", "Rehearsal real wajib memiliki owner dan approver.", 400],
    ["REHEARSAL_ACTOR_REQUIRED", "Identitas pelaksana rehearsal tidak valid.", 400],
    ["REHEARSAL_KEY_INVALID", "Kunci rehearsal harus memakai huruf kecil, angka, tanda hubung, atau garis bawah.", 400],
    ["REHEARSAL_TITLE_REQUIRED", "Judul rehearsal wajib diisi minimal lima karakter.", 400],
    ["REHEARSAL_ENVIRONMENT_INVALID", "Environment rehearsal tidak valid.", 400],
    ["REHEARSAL_PLAN_LOCKED", "Rencana rehearsal tidak dapat diedit setelah dimulai.", 409],
    ["REHEARSAL_RELEASE_IMMUTABLE", "Release rehearsal tidak dapat diganti setelah rencana dibuat.", 409],
    ["REHEARSAL_NOT_IN_PROGRESS", "Langkah hanya dapat diperbarui saat rehearsal berlangsung.", 409],
    ["REHEARSAL_STEP_STATUS_INVALID", "Status langkah rehearsal tidak valid.", 400],
    ["REHEARSAL_STEP_OWNER_REQUIRED", "Owner langkah wajib diisi sebelum pengujian dimulai.", 400],
    ["REHEARSAL_STEP_EVIDENCE_REQUIRED", "Langkah lulus atau gagal wajib memiliki evidence dan hasil aktual.", 400],
    ["REHEARSAL_STEP_BLOCKER_REQUIRED", "Alasan blocker wajib diisi.", 400],
    ["REHEARSAL_STEP_URL_INVALID", "Tautan evidence harus memakai HTTPS.", 400],
    ["REHEARSAL_TRANSITION_INVALID", "Target status rehearsal tidak valid.", 400],
    ["REHEARSAL_STATUS_TRANSITION_INVALID", "Perubahan status rehearsal tidak valid.", 409],
    ["REHEARSAL_COMPLETION_EVIDENCE_REQUIRED", "Ringkasan dan hasil rollback wajib diisi sebelum rehearsal dinyatakan lulus.", 400],
    ["REHEARSAL_FAILURE_REASON_REQUIRED", "Alasan kegagalan wajib diisi.", 400],
    ["REHEARSAL_REAL_PRODUCTION_REQUIRED", "Kelulusan membutuhkan rehearsal production yang non-mock.", 409],
    ["REHEARSAL_REQUIRED_STEPS_INCOMPLETE", "Delapan langkah wajib harus lulus terlebih dahulu.", 409],
    ["REHEARSAL_FRESH_SNAPSHOT_REQUIRED", "Gunakan snapshot real non-critical yang berusia kurang dari 24 jam.", 409],
    ["CERTIFICATION_APPROVED_RELEASE_REQUIRED", "Sertifikasi membutuhkan release approved non-mock.", 409],
    ["CERTIFICATION_ACTOR_REQUIRED", "Identitas pengambil keputusan tidak valid.", 400],
    ["CERTIFICATION_DECISION_INVALID", "Keputusan sertifikasi tidak valid.", 400],
    ["CERTIFICATION_NOTE_REQUIRED", "Dasar keputusan wajib diisi minimal sepuluh karakter.", 400],
    ["CERTIFICATION_CONDITIONS_INVALID", "Daftar kondisi sertifikasi tidak valid.", 400],
    ["CERTIFICATION_CONDITIONS_REQUIRED", "Penerimaan bersyarat wajib menyertakan kondisi.", 400],
    ["CERTIFICATION_REAL_EVIDENCE_REQUIRED", "Keputusan menerima wajib menggunakan evidence real, bukan mock.", 409],
    ["CERTIFICATION_RUNTIME_ACTIVE", "Aktifkan kill switch sebelum mengubah sertifikasi release aktif.", 409],
    ["CERTIFICATION_EVIDENCE_REFERENCE_INVALID", "Rehearsal dan snapshot harus ada serta terikat pada release yang sama.", 409],
    ["CERTIFICATION_REHEARSAL_INVALID", "Sertifikasi membutuhkan rehearsal production yang lulus dan terikat snapshot.", 409],
    ["CERTIFICATION_SNAPSHOT_INVALID", "Snapshot sertifikasi tidak valid, mock, critical, atau kedaluwarsa.", 409],
    ["CERTIFICATION_UAT_INCOMPLETE", "Seluruh skenario UAT wajib harus lulus dengan evidence.", 409],
    ["CERTIFICATION_POLICIES_INCOMPLETE", "Keempat policy monitoring wajib real, aktif, dan memiliki owner.", 409],
    ["CERTIFICATION_CRITICAL_INCIDENT_OPEN", "Critical incident harus diselesaikan sebelum sertifikasi.", 409],
    ["CERTIFICATION_HIGH_INCIDENT_OPEN", "High incident harus diselesaikan untuk penerimaan penuh.", 409],
    ["CERTIFICATION_HEALTHY_SNAPSHOT_REQUIRED", "Penerimaan penuh membutuhkan snapshot healthy tanpa blocker.", 409],
  ];
  return errors.find(([code]) => message.includes(code));
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, pilotCertificationMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_PILOT_CERTIFICATION_MUTATION");

  const input = parsed.data;
  const db = createServerSupabase();
  let result;
  if (input.action === "save_rehearsal") {
    result = await db.rpc("save_pilot_rehearsal", {
      p_rehearsal_id: input.rehearsalId || null,
      p_release_id: input.releaseId,
      p_rehearsal_key: input.rehearsalKey,
      p_title: input.title,
      p_environment: input.environment,
      p_owner: input.owner || null,
      p_approver: input.approver || null,
      p_is_mock: input.isMock,
      p_actor: admin.email,
    });
  } else if (input.action === "update_step") {
    result = await db.rpc("update_pilot_rehearsal_step", {
      p_step_id: input.stepId,
      p_actor: admin.email,
      p_status: input.status,
      p_owner: input.owner || null,
      p_evidence_note: input.evidenceNote || null,
      p_evidence_url: input.evidenceUrl || null,
      p_actual_result: input.actualResult || null,
      p_blocker_reason: input.blockerReason || null,
    });
  } else if (input.action === "transition_rehearsal") {
    result = await db.rpc("transition_pilot_rehearsal", {
      p_rehearsal_id: input.rehearsalId,
      p_actor: admin.email,
      p_status: input.nextStatus,
      p_snapshot_id: input.snapshotId || null,
      p_summary: input.summary || null,
      p_rollback_result: input.rollbackResult || null,
      p_failure_reason: input.failureReason || null,
    });
  } else {
    result = await db.rpc("record_pilot_acceptance_certification", {
      p_release_id: input.releaseId,
      p_rehearsal_id: input.rehearsalId,
      p_snapshot_id: input.snapshotId,
      p_actor: admin.email,
      p_decision: input.decision,
      p_conditions: input.conditions,
      p_decision_note: input.decisionNote,
      p_is_mock: input.isMock,
    });
  }

  if (result.error) {
    const known = knownMutationError(result.error.message);
    if (known) return adminError(known[1], known[2], known[0]);
    if (missingPhase12(result.error)) return adminError("Migration Fase 12 belum diterapkan.", 409, "PHASE12_MIGRATION_REQUIRED");
    return adminError(result.error.message, 500, "PILOT_CERTIFICATION_MUTATION_FAILED");
  }
  return NextResponse.json({
    success: true,
    activationLocked: true,
    outboundTriggered: false,
    result: result.data,
  });
}
