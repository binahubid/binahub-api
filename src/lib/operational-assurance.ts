export const ASSURED_WORKFLOW_KEYS = [
  "follow_up_scheduler",
  "transformation_event_worker",
  "client_operations_daily",
  "acquisition_batch_processor",
] as const;

export type AssuredWorkflowKey = (typeof ASSURED_WORKFLOW_KEYS)[number];
export type OperationalHealth = "healthy" | "warning" | "critical" | "insufficient_data";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type MonitoringPolicy = {
  workflowKey: AssuredWorkflowKey;
  lookbackHours: number;
  minimumRuns: number;
  maximumFailureRatePercent: number;
  staleRunningMinutes: number;
  maximumConsecutiveFailures: number;
  enabled: boolean;
};

export type AutomationRunEvidence = {
  id: string;
  workflowKey: string;
  status: "running" | "succeeded" | "partial" | "failed" | "deferred";
  dryRun: boolean;
  candidateCount: number;
  processedCount: number;
  failureCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type RuntimeEvidence = {
  workflowKey: AssuredWorkflowKey;
  requestedMode: "disabled" | "dry_run" | "pilot" | "live";
  pilotReleaseId: string | null;
  environmentDryRun: boolean;
};

export type OperationalFinding = {
  findingKey: string;
  workflowKey: AssuredWorkflowKey;
  code: string;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  blocksPilot: boolean;
  incidentEligible: boolean;
  sourceRunId: string | null;
};

export type WorkflowHealth = {
  workflowKey: AssuredWorkflowKey;
  status: OperationalHealth;
  runCount: number;
  completedRunCount: number;
  succeededRunCount: number;
  failedRunCount: number;
  partialRunCount: number;
  deferredRunCount: number;
  runningRunCount: number;
  failureRatePercent: number;
  consecutiveFailures: number;
  latestRunAt: string | null;
  latestRunStatus: AutomationRunEvidence["status"] | null;
  findings: OperationalFinding[];
};

export type OperationalAssuranceResult = {
  overallStatus: OperationalHealth;
  evaluatedAt: string;
  workflows: WorkflowHealth[];
  findings: OperationalFinding[];
  blockers: OperationalFinding[];
};

const HEALTH_RANK: Record<OperationalHealth, number> = {
  healthy: 0,
  insufficient_data: 1,
  warning: 2,
  critical: 3,
};

function statusFromFindings(findings: OperationalFinding[], runCount: number): OperationalHealth {
  if (findings.some((item) => item.severity === "critical")) return "critical";
  if (findings.some((item) => item.severity === "high" || item.severity === "medium")) return "warning";
  if (runCount === 0 || findings.some((item) => item.code === "MINIMUM_RUN_EVIDENCE_MISSING")) {
    return "insufficient_data";
  }
  return "healthy";
}

function finding(
  workflowKey: AssuredWorkflowKey,
  code: string,
  severity: IncidentSeverity,
  title: string,
  summary: string,
  options: { blocksPilot?: boolean; incidentEligible?: boolean; sourceRunId?: string | null } = {},
): OperationalFinding {
  return {
    findingKey: `${workflowKey}:${code}`,
    workflowKey,
    code,
    severity,
    title,
    summary,
    blocksPilot: options.blocksPilot !== false,
    incidentEligible: options.incidentEligible === true,
    sourceRunId: options.sourceRunId || null,
  };
}

export function evaluateOperationalAssurance(input: {
  policies: MonitoringPolicy[];
  runs: AutomationRunEvidence[];
  runtime: RuntimeEvidence[];
  evaluatedAt?: Date;
}): OperationalAssuranceResult {
  const evaluatedAt = input.evaluatedAt || new Date();
  const policyByWorkflow = new Map(input.policies.map((policy) => [policy.workflowKey, policy]));
  const runtimeByWorkflow = new Map(input.runtime.map((runtime) => [runtime.workflowKey, runtime]));
  const workflows: WorkflowHealth[] = [];

  for (const workflowKey of ASSURED_WORKFLOW_KEYS) {
    const policy = policyByWorkflow.get(workflowKey);
    const runtime = runtimeByWorkflow.get(workflowKey);
    const findings: OperationalFinding[] = [];

    if (!policy || !policy.enabled) {
      findings.push(finding(
        workflowKey,
        "MONITORING_POLICY_DISABLED",
        "critical",
        "Monitoring workflow tidak aktif",
        "Policy monitoring belum tersedia atau dinonaktifkan. Pilot tidak boleh berjalan tanpa policy aktif.",
        { incidentEligible: true },
      ));
    }

    const lookbackHours = policy?.lookbackHours || 24;
    const windowStart = evaluatedAt.getTime() - lookbackHours * 60 * 60 * 1000;
    const runs = input.runs
      .filter((run) => run.workflowKey === workflowKey && new Date(run.startedAt).getTime() >= windowStart)
      .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
    const completed = runs.filter((run) => ["succeeded", "partial", "failed"].includes(run.status));
    const failed = completed.filter((run) => run.status === "failed");
    const partial = completed.filter((run) => run.status === "partial");
    const succeeded = completed.filter((run) => run.status === "succeeded");
    const failureLike = completed.filter((run) => run.status === "failed" || run.status === "partial");
    const failureRatePercent = completed.length
      ? Math.round((failureLike.length / completed.length) * 10_000) / 100
      : 0;
    let consecutiveFailures = 0;
    for (const run of completed) {
      if (run.status === "succeeded") break;
      consecutiveFailures += 1;
    }

    if (policy?.enabled && runs.length < policy.minimumRuns) {
      findings.push(finding(
        workflowKey,
        "MINIMUM_RUN_EVIDENCE_MISSING",
        "low",
        "Bukti eksekusi belum cukup",
        `Ditemukan ${runs.length} run dalam ${policy.lookbackHours} jam; minimum policy adalah ${policy.minimumRuns}.`,
        { incidentEligible: false },
      ));
    }

    const staleRuns = runs.filter((run) => (
      run.status === "running"
      && evaluatedAt.getTime() - new Date(run.startedAt).getTime()
        > (policy?.staleRunningMinutes || 30) * 60 * 1000
    ));
    if (staleRuns.length) {
      findings.push(finding(
        workflowKey,
        "STALE_RUNNING_EXECUTION",
        "critical",
        "Eksekusi automation tersangkut",
        `${staleRuns.length} run masih berstatus running melewati batas ${policy?.staleRunningMinutes || 30} menit.`,
        { incidentEligible: true, sourceRunId: staleRuns[0].id },
      ));
    }

    if (policy?.enabled && completed.length >= policy.minimumRuns
      && failureRatePercent > policy.maximumFailureRatePercent) {
      findings.push(finding(
        workflowKey,
        "FAILURE_RATE_EXCEEDED",
        "high",
        "Failure rate melewati policy",
        `Failure rate ${failureRatePercent}% melampaui batas ${policy.maximumFailureRatePercent}% pada window ${policy.lookbackHours} jam.`,
        { incidentEligible: true, sourceRunId: failureLike[0]?.id },
      ));
    }

    if (policy?.enabled && consecutiveFailures >= policy.maximumConsecutiveFailures) {
      findings.push(finding(
        workflowKey,
        "CONSECUTIVE_FAILURES_EXCEEDED",
        consecutiveFailures > policy.maximumConsecutiveFailures ? "critical" : "high",
        "Kegagalan beruntun terdeteksi",
        `${consecutiveFailures} run terakhir gagal atau partial; batas policy ${policy.maximumConsecutiveFailures}.`,
        { incidentEligible: true, sourceRunId: failureLike[0]?.id },
      ));
    }

    if (!runtime) {
      findings.push(finding(
        workflowKey,
        "RUNTIME_CONTROL_MISSING",
        "critical",
        "Runtime control tidak ditemukan",
        "Workflow tidak memiliki runtime ceiling yang dapat diverifikasi.",
        { incidentEligible: true },
      ));
    } else {
      if (["pilot", "live"].includes(runtime.requestedMode) && !runtime.pilotReleaseId) {
        findings.push(finding(
          workflowKey,
          "ACTIVE_MODE_WITHOUT_RELEASE",
          "critical",
          "Mode aktif tidak terikat release",
          `Requested mode ${runtime.requestedMode} tidak mempunyai release pilot yang valid.`,
          { incidentEligible: true },
        ));
      }
      if (runtime.requestedMode === "dry_run" && !runtime.environmentDryRun) {
        findings.push(finding(
          workflowKey,
          "ENVIRONMENT_GUARD_DRIFT",
          "critical",
          "Environment lebih permisif dari database",
          "Database meminta dry-run tetapi environment worker mengizinkan eksekusi live.",
          { incidentEligible: true },
        ));
      }
      if (["pilot", "live"].includes(runtime.requestedMode) && runtime.environmentDryRun) {
        findings.push(finding(
          workflowKey,
          "ENVIRONMENT_ACTIVATION_PENDING",
          "low",
          "Environment masih dry-run",
          "Requested mode sudah disetujui, tetapi environment guard masih menahan eksekusi. Aktivasi tetap langkah deployment terpisah.",
          { blocksPilot: false, incidentEligible: false },
        ));
      }
    }

    workflows.push({
      workflowKey,
      status: statusFromFindings(findings, runs.length),
      runCount: runs.length,
      completedRunCount: completed.length,
      succeededRunCount: succeeded.length,
      failedRunCount: failed.length,
      partialRunCount: partial.length,
      deferredRunCount: runs.filter((run) => run.status === "deferred").length,
      runningRunCount: runs.filter((run) => run.status === "running").length,
      failureRatePercent,
      consecutiveFailures,
      latestRunAt: runs[0]?.startedAt || null,
      latestRunStatus: runs[0]?.status || null,
      findings,
    });
  }

  const findings = workflows.flatMap((workflow) => workflow.findings);
  const overallStatus = workflows.reduce<OperationalHealth>((current, workflow) => (
    HEALTH_RANK[workflow.status] > HEALTH_RANK[current] ? workflow.status : current
  ), "healthy");

  return {
    overallStatus,
    evaluatedAt: evaluatedAt.toISOString(),
    workflows,
    findings,
    blockers: findings.filter((item) => item.blocksPilot),
  };
}
