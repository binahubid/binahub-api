import { describe, expect, it, vi } from "vitest";
import {
  evaluateServiceHealth,
  loadServiceHealth,
  reportWorkerHeartbeat,
} from "./service-health";
import type { createServerSupabase } from "./supabase";

const now = new Date("2026-11-02T10:00:00Z");
const snapshot = () => ({
  version: 1,
  checkedAt: now.toISOString(),
  overdueMinutes: 10,
  workerStaleMinutes: 10,
  queues: [
    "team_analysis",
    "individual_email",
    "program_analysis",
    "program_email",
  ].map((key) => ({
    key,
    pending: 0,
    processing: 0,
    overdue: 0,
    stalled: 0,
    review: 0,
    oldestDueAt: null,
  })),
  worker: {
    startedAt: now.toISOString(),
    finishedAt: now.toISOString(),
    succeededAt: now.toISOString(),
    outcome: "ok",
  },
});
const database = (value: unknown, throws = false) =>
  ({
    rpc: vi.fn(() => ({
      abortSignal: vi.fn(() =>
        throws
          ? Promise.reject(new Error("PRIVATE_DETAILS"))
          : Promise.resolve(value),
      ),
    })),
  }) as unknown as ReturnType<typeof createServerSupabase>;
describe("service readiness is not liveness or delivery proof", () => {
  it("keeps no heartbeat, stale heartbeat and partial failure separate from a healthy queue", () => {
    expect(evaluateServiceHealth(snapshot(), now)).toMatchObject({
      readiness: "ready",
      operations: "healthy",
      externalAlertsEnabled: false,
      worker: { state: "recent" },
    });
    expect(
      evaluateServiceHealth({ ...snapshot(), worker: null }, now),
    ).toMatchObject({
      readiness: "ready",
      operations: "attention",
      worker: { state: "never_seen" },
    });
    for (const [outcome, state] of [
      ["error", "failed"],
      ["degraded", "degraded"],
      ["running", "running"],
    ]) {
      expect(
        evaluateServiceHealth(
          { ...snapshot(), worker: { ...snapshot().worker, outcome } },
          now,
        ).worker.state,
      ).toBe(state);
    }
    const old = { ...snapshot().worker, startedAt: "2026-11-02T09:49:59Z" };
    expect(
      evaluateServiceHealth({ ...snapshot(), worker: old }, now).worker.state,
    ).toBe("stale");
  });
  it("alerts on overdue, stalled or held jobs, but not a future retry or a normal active lease", () => {
    const input = snapshot();
    input.queues[0].pending = 1;
    input.queues[0].processing = 1;
    expect(evaluateServiceHealth(input, now).operations).toBe("healthy");
    for (const key of ["overdue", "stalled", "review"] as const) {
      const warning = snapshot();
      warning.queues[0][key] = 1;
      expect(evaluateServiceHealth(warning, now).operations).toBe("attention");
    }
  });
  it("rejects incomplete, duplicate, stale or unbounded evidence instead of fabricating zero counts", () => {
    const base = snapshot();
    for (const bad of [
      null,
      {},
      { ...base, queues: base.queues.slice(1) },
      { ...base, queues: Array(4).fill(base.queues[0]) },
      { ...base, checkedAt: "2026-11-02T09:55:00Z" },
      { ...base, checkedAt: "2026-11-03T10:00:00Z" },
      { ...base, queues: base.queues.map((q) => ({ ...q, pending: -1 })) },
    ])
      expect(() => evaluateServiceHealth(bad, now)).toThrow();
  });
  it("reports missing migration and transport/schema failure as unknown without raw diagnostics", async () => {
    expect(
      await loadServiceHealth(
        database({ error: { code: "PGRST202", message: "PRIVATE_DETAILS" } }),
      ),
    ).toEqual({ readiness: "setup_required", operations: "unknown" });
    for (const db of [
      database({}, true),
      database({ data: { private: "PRIVATE_DETAILS" } }),
      database({ error: { code: "XX", message: "PRIVATE_DETAILS" } }),
    ]) {
      expect(await loadServiceHealth(db)).toEqual({
        readiness: "unavailable",
        operations: "unknown",
      });
    }
  });
  it("bounds heartbeat RPCs, uses only the invocation ID/outcome and tolerates a missing migration", async () => {
    const db = database({ data: true, error: null });
    expect(await reportWorkerHeartbeat(db, "synthetic-run")).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("begin_report_worker_heartbeat", {
      p_run_token: "synthetic-run",
    });
    expect(await reportWorkerHeartbeat(db, "synthetic-run", "degraded")).toBe(
      true,
    );
    expect(db.rpc).toHaveBeenCalledWith("finish_report_worker_heartbeat", {
      p_run_token: "synthetic-run",
      p_outcome: "degraded",
    });
    expect(
      await reportWorkerHeartbeat(
        database({ error: { code: "PGRST202" } }),
        "synthetic-run",
      ),
    ).toBe(false);
    expect(
      await reportWorkerHeartbeat(database({}, true), "synthetic-run"),
    ).toBe(false);
  });
});
