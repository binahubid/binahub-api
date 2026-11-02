import { z } from "zod";
import type { createServerSupabase } from "./supabase";

type HealthDb = ReturnType<typeof createServerSupabase>;
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().safe();
export const serviceQueueSchema = z
  .object({
    key: z.enum([
      "team_analysis",
      "individual_email",
      "program_analysis",
      "program_email",
    ]),
    pending: count,
    processing: count,
    overdue: count,
    stalled: count,
    review: count,
    oldestDueAt: timestamp.nullable(),
  })
  .strict();
const snapshotSchema = z
  .object({
    version: z.literal(1),
    checkedAt: timestamp,
    overdueMinutes: z.literal(10),
    workerStaleMinutes: z.literal(10),
    queues: z.array(serviceQueueSchema).length(4),
    worker: z
      .object({
        startedAt: timestamp,
        finishedAt: timestamp.nullable(),
        succeededAt: timestamp.nullable(),
        outcome: z.enum(["running", "ok", "degraded", "error"]),
      })
      .strict()
      .nullable(),
  })
  .strict();

export function evaluateServiceHealth(raw: unknown, now = new Date()) {
  const snapshot = snapshotSchema.parse(raw);
  if (new Set(snapshot.queues.map((queue) => queue.key)).size !== 4)
    throw new Error("HEALTH_SNAPSHOT_INVALID");
  const snapshotAge = now.getTime() - Date.parse(snapshot.checkedAt);
  if (snapshotAge < -60_000 || snapshotAge > 120_000)
    throw new Error("HEALTH_SNAPSHOT_STALE");
  const heartbeat = snapshot.worker;
  const age = heartbeat
    ? now.getTime() - Date.parse(heartbeat.startedAt)
    : null;
  if (age !== null && age < -60_000)
    throw new Error("HEALTH_HEARTBEAT_INVALID");
  const workerState = !heartbeat
    ? ("never_seen" as const)
    : age! > snapshot.workerStaleMinutes * 60_000
      ? ("stale" as const)
      : heartbeat.outcome === "error"
        ? ("failed" as const)
        : heartbeat.outcome === "degraded"
          ? ("degraded" as const)
          : heartbeat.outcome === "running"
            ? ("running" as const)
            : ("recent" as const);
  const issues = snapshot.queues.reduce(
    (total, queue) => total + queue.overdue + queue.stalled + queue.review,
    0,
  );
  return {
    readiness: "ready" as const,
    operations:
      issues ||
      ["never_seen", "stale", "failed", "degraded"].includes(workerState)
        ? ("attention" as const)
        : ("healthy" as const),
    checkedAt: snapshot.checkedAt,
    overdueMinutes: snapshot.overdueMinutes,
    queues: snapshot.queues,
    worker: { state: workerState, ...heartbeat },
    alertChannel: "admin_dashboard" as const,
    externalAlertsEnabled: false as const,
  };
}

export async function loadServiceHealth(db: HealthDb) {
  try {
    const result = await db
      .rpc("read_service_health_snapshot")
      .abortSignal(AbortSignal.timeout(5000));
    if (result.error) {
      const reason = ["42883", "PGRST202", "42P01"].includes(
        result.error.code || "",
      )
        ? ("setup_required" as const)
        : ("unavailable" as const);
      return { readiness: reason, operations: "unknown" as const };
    }
    return evaluateServiceHealth(result.data);
  } catch {
    return {
      readiness: "unavailable" as const,
      operations: "unknown" as const,
    };
  }
}

/** Best-effort telemetry must not block existing delivery during a rolling deployment. */
export async function reportWorkerHeartbeat(
  db: HealthDb,
  runToken: string,
  outcome?: "ok" | "degraded" | "error",
) {
  try {
    const result = await (
      outcome
        ? db.rpc("finish_report_worker_heartbeat", {
            p_run_token: runToken,
            p_outcome: outcome,
          })
        : db.rpc("begin_report_worker_heartbeat", { p_run_token: runToken })
    ).abortSignal(AbortSignal.timeout(2000));
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
