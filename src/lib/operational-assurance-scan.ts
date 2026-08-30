import {
  ASSURED_WORKFLOW_KEYS,
  evaluateOperationalAssurance,
  type AssuredWorkflowKey,
  type AutomationRunEvidence,
  type MonitoringPolicy,
  type RuntimeEvidence,
} from "@/lib/operational-assurance";
import type { createServerSupabase } from "@/lib/supabase";

type AssuranceDb = ReturnType<typeof createServerSupabase>;

type PolicyRow = {
  workflow_key: AssuredWorkflowKey;
  lookback_hours: number;
  minimum_runs: number;
  maximum_failure_rate_percent: number | string;
  stale_running_minutes: number;
  maximum_consecutive_failures: number;
  enabled: boolean;
  owner: string | null;
  is_mock: boolean;
  version: number;
};

type RunRow = {
  id: string;
  workflow_key: string;
  status: AutomationRunEvidence["status"];
  dry_run: boolean;
  candidate_count: number;
  processed_count: number;
  failure_count: number;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
};

type RuntimeRow = {
  workflow_key: AssuredWorkflowKey;
  requested_mode: RuntimeEvidence["requestedMode"];
  pilot_release_id: string | null;
};

export const WORKFLOW_ENVIRONMENT_DRY_RUN: Record<AssuredWorkflowKey, () => boolean> = {
  follow_up_scheduler: () => process.env.FOLLOW_UP_DRY_RUN !== "false",
  transformation_event_worker: () => process.env.TRANSFORMATION_WORKER_DRY_RUN !== "false",
  client_operations_daily: () => process.env.OPERATIONS_DRY_RUN !== "false",
  acquisition_batch_processor: () => process.env.ACQUISITION_DRY_RUN !== "false",
};

function toPolicy(item: PolicyRow): MonitoringPolicy {
  return {
    workflowKey: item.workflow_key,
    lookbackHours: item.lookback_hours,
    minimumRuns: item.minimum_runs,
    maximumFailureRatePercent: Number(item.maximum_failure_rate_percent),
    staleRunningMinutes: item.stale_running_minutes,
    maximumConsecutiveFailures: item.maximum_consecutive_failures,
    enabled: item.enabled,
  };
}

function toRun(item: RunRow): AutomationRunEvidence {
  return {
    id: item.id,
    workflowKey: item.workflow_key,
    status: item.status,
    dryRun: item.dry_run,
    candidateCount: item.candidate_count,
    processedCount: item.processed_count,
    failureCount: item.failure_count,
    startedAt: item.started_at,
    finishedAt: item.finished_at,
    errorMessage: item.error_message,
  };
}

function toRuntime(item: RuntimeRow): RuntimeEvidence {
  return {
    workflowKey: item.workflow_key,
    requestedMode: item.requested_mode,
    pilotReleaseId: item.pilot_release_id,
    environmentDryRun: WORKFLOW_ENVIRONMENT_DRY_RUN[item.workflow_key](),
  };
}

function missingPhase11(error: { code?: string; message?: string } | null | undefined) {
  return Boolean(error && (error.code === "42P01" || error.message?.includes("does not exist")));
}

export async function runOperationalAssuranceScan(input: {
  db: AssuranceDb;
  actor: string;
  releaseId?: string | null;
  materializeIncidents: boolean;
  idempotencyKey?: string | null;
  now?: Date;
}) {
  const now = input.now || new Date();
  const policiesResult = await input.db.from("automation_monitoring_policies")
    .select("workflow_key, lookback_hours, minimum_runs, maximum_failure_rate_percent, stale_running_minutes, maximum_consecutive_failures, enabled, owner, is_mock, version")
    .order("workflow_key", { ascending: true });
  if (policiesResult.error) {
    if (missingPhase11(policiesResult.error)) throw new Error("PHASE11_MIGRATION_REQUIRED");
    throw new Error(`Monitoring policy gagal dibaca: ${policiesResult.error.message}`);
  }

  const policyRows = (policiesResult.data || []) as PolicyRow[];
  const maximumLookbackHours = Math.max(1, ...policyRows.map((item) => item.lookback_hours));
  const windowStartedAt = new Date(now.getTime() - maximumLookbackHours * 60 * 60 * 1000);
  const [runsResult, controlsResult] = await Promise.all([
    input.db.from("automation_runs")
      .select("id, workflow_key, status, dry_run, candidate_count, processed_count, failure_count, started_at, finished_at, error_message")
      .in("workflow_key", [...ASSURED_WORKFLOW_KEYS])
      .gte("started_at", windowStartedAt.toISOString())
      .order("started_at", { ascending: false })
      .limit(2000),
    input.db.from("automation_runtime_controls")
      .select("workflow_key, requested_mode, pilot_release_id")
      .in("workflow_key", [...ASSURED_WORKFLOW_KEYS]),
  ]);
  const evidenceError = runsResult.error || controlsResult.error;
  if (evidenceError) throw new Error(`Evidence automation gagal dibaca: ${evidenceError.message}`);

  let releaseId = input.releaseId || null;
  if (releaseId) {
    const releaseResult = await input.db.from("pilot_release_plans")
      .select("id, status, is_mock")
      .eq("id", releaseId)
      .maybeSingle();
    if (releaseResult.error) throw new Error(`Release pilot gagal dibaca: ${releaseResult.error.message}`);
    if (!releaseResult.data) throw new Error("PILOT_RELEASE_NOT_FOUND");
  } else {
    const releaseResult = await input.db.from("pilot_release_plans")
      .select("id")
      .in("status", ["approved", "scheduled"])
      .eq("is_mock", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (releaseResult.error) throw new Error(`Release pilot gagal dibaca: ${releaseResult.error.message}`);
    releaseId = releaseResult.data?.id || null;
  }

  const result = evaluateOperationalAssurance({
    policies: policyRows.map(toPolicy),
    runs: ((runsResult.data || []) as RunRow[]).map(toRun),
    runtime: ((controlsResult.data || []) as RuntimeRow[]).map(toRuntime),
    evaluatedAt: now,
  });
  const hourKey = now.toISOString().slice(0, 13).replaceAll(":", "-");
  const idempotencyKey = input.idempotencyKey?.trim()
    || `phase11:${releaseId || "no-release"}:${hourKey}`;
  const isMock = !releaseId
    || policyRows.length !== ASSURED_WORKFLOW_KEYS.length
    || policyRows.some((item) => item.is_mock || !item.owner || !item.enabled);

  const snapshotResult = await input.db.rpc("record_pilot_monitoring_snapshot", {
    p_release_id: releaseId,
    p_idempotency_key: idempotencyKey,
    p_actor: input.actor,
    p_window_started_at: windowStartedAt.toISOString(),
    p_window_ended_at: now.toISOString(),
    p_overall_status: result.overallStatus,
    p_metrics: {
      evaluatedAt: result.evaluatedAt,
      workflowCount: result.workflows.length,
      workflows: result.workflows,
    },
    p_findings: result.findings,
    p_blockers: result.blockers,
    p_dry_run: !input.materializeIncidents,
    p_is_mock: isMock,
  });
  if (snapshotResult.error) {
    if (missingPhase11(snapshotResult.error)) throw new Error("PHASE11_MIGRATION_REQUIRED");
    throw new Error(`Snapshot monitoring gagal disimpan: ${snapshotResult.error.message}`);
  }

  const materializedIncidents: unknown[] = [];
  if (input.materializeIncidents) {
    for (const item of result.findings.filter((finding) => finding.incidentEligible)) {
      const incidentResult = await input.db.rpc("upsert_automation_incident", {
        p_incident_key: `${releaseId || "global"}:${item.findingKey}`,
        p_workflow_key: item.workflowKey,
        p_release_id: releaseId,
        p_severity: item.severity,
        p_title: item.title,
        p_summary: item.summary,
        p_source_run_id: item.sourceRunId,
        p_actor: input.actor,
        p_source_type: "watchdog",
      });
      if (incidentResult.error) throw new Error(`Incident gagal dicatat: ${incidentResult.error.message}`);
      materializedIncidents.push(incidentResult.data);
    }
  }

  return {
    ...result,
    releaseId,
    snapshot: snapshotResult.data,
    dryRun: !input.materializeIncidents,
    isMock,
    materializedIncidentCount: materializedIncidents.length,
    materializedIncidents,
  };
}
