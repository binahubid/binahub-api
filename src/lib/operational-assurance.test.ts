import { describe, expect, it } from "vitest";
import {
  ASSURED_WORKFLOW_KEYS,
  evaluateOperationalAssurance,
  type AutomationRunEvidence,
  type MonitoringPolicy,
  type RuntimeEvidence,
} from "./operational-assurance";

const now = new Date("2026-08-30T08:00:00.000Z");
const policies: MonitoringPolicy[] = ASSURED_WORKFLOW_KEYS.map((workflowKey) => ({
  workflowKey,
  lookbackHours: 24,
  minimumRuns: 1,
  maximumFailureRatePercent: 20,
  staleRunningMinutes: 30,
  maximumConsecutiveFailures: 2,
  enabled: true,
}));
const runtime: RuntimeEvidence[] = ASSURED_WORKFLOW_KEYS.map((workflowKey) => ({
  workflowKey,
  requestedMode: "dry_run",
  pilotReleaseId: null,
  environmentDryRun: true,
}));

function run(workflowKey: string, status: AutomationRunEvidence["status"], index = 0): AutomationRunEvidence {
  return {
    id: `${workflowKey}-${index}`,
    workflowKey,
    status,
    dryRun: true,
    candidateCount: 1,
    processedCount: status === "succeeded" ? 1 : 0,
    failureCount: status === "succeeded" ? 0 : 1,
    startedAt: new Date(now.getTime() - (index + 1) * 60_000).toISOString(),
    finishedAt: status === "running" ? null : now.toISOString(),
    errorMessage: status === "failed" ? "test failure" : null,
  };
}

describe("operational assurance evaluator", () => {
  it("reports healthy when every workflow has successful evidence", () => {
    const runs = ASSURED_WORKFLOW_KEYS.map((workflowKey) => run(workflowKey, "succeeded"));
    const result = evaluateOperationalAssurance({ policies, runs, runtime, evaluatedAt: now });
    expect(result.overallStatus).toBe("healthy");
    expect(result.blockers).toHaveLength(0);
  });

  it("does not treat missing evidence as healthy", () => {
    const result = evaluateOperationalAssurance({ policies, runs: [], runtime, evaluatedAt: now });
    expect(result.overallStatus).toBe("insufficient_data");
    expect(result.blockers).toHaveLength(4);
    expect(result.findings.every((item) => item.incidentEligible === false)).toBe(true);
  });

  it("raises an incident-eligible finding for stale executions and repeated failures", () => {
    const stale = run("follow_up_scheduler", "running");
    stale.startedAt = new Date(now.getTime() - 60 * 60_000).toISOString();
    const runs = [
      stale,
      run("follow_up_scheduler", "failed", 1),
      run("follow_up_scheduler", "failed", 2),
      ...ASSURED_WORKFLOW_KEYS.slice(1).map((workflowKey) => run(workflowKey, "succeeded")),
    ];
    const result = evaluateOperationalAssurance({ policies, runs, runtime, evaluatedAt: now });
    expect(result.overallStatus).toBe("critical");
    expect(result.findings.some((item) => item.code === "STALE_RUNNING_EXECUTION" && item.incidentEligible)).toBe(true);
    expect(result.findings.some((item) => item.code === "CONSECUTIVE_FAILURES_EXCEEDED")).toBe(true);
  });

  it("detects when environment is more permissive than the database", () => {
    const runs = ASSURED_WORKFLOW_KEYS.map((workflowKey) => run(workflowKey, "succeeded"));
    const unsafeRuntime = runtime.map((item) => item.workflowKey === "client_operations_daily"
      ? { ...item, environmentDryRun: false }
      : item);
    const result = evaluateOperationalAssurance({ policies, runs, runtime: unsafeRuntime, evaluatedAt: now });
    expect(result.overallStatus).toBe("critical");
    expect(result.findings.some((item) => item.code === "ENVIRONMENT_GUARD_DRIFT")).toBe(true);
  });
});
