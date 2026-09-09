import { describe, expect, it, vi } from "vitest";
import { claimAutomationRun, finishAutomationRun } from "./automation-run";

function claimDb(input: {
  insertData?: { id: string } | null;
  insertError?: { code?: string; message: string } | null;
  existingData?: Record<string, unknown> | null;
  existingError?: { message: string } | null;
}) {
  const insertSingle = vi.fn(async () => ({
    data: input.insertData ?? null,
    error: input.insertError ?? null,
  }));
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));

  const maybeSingle = vi.fn(async () => ({
    data: input.existingData ?? null,
    error: input.existingError ?? null,
  }));
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));

  return {
    db: { from: vi.fn(() => ({ insert, select })) },
    insert,
    select,
  };
}

describe("automation run claim", () => {
  it("claims a new run before any workflow side effect", async () => {
    const fixture = claimDb({ insertData: { id: "run-1" } });
    const result = await claimAutomationRun(fixture.db as never, {
      workflowKey: "follow_up_scheduler",
      idempotencyKey: "request-1",
      triggerSource: "test",
      dryRun: false,
      referenceDate: "2026-09-08",
    });

    expect(result).toEqual({ claimed: true, runId: "run-1" });
    expect(fixture.insert).toHaveBeenCalledOnce();
    expect(fixture.select).not.toHaveBeenCalled();
  });

  it("returns the immutable existing run after a unique-key collision", async () => {
    const existing = {
      id: "run-1",
      status: "succeeded",
      dry_run: false,
      candidate_count: 5,
      processed_count: 5,
      failure_count: 0,
      summary: { sentCount: 5 },
      started_at: "2026-09-08T02:30:00.000Z",
      finished_at: "2026-09-08T02:31:00.000Z",
    };
    const fixture = claimDb({
      insertError: { code: "23505", message: "duplicate key" },
      existingData: existing,
    });

    const result = await claimAutomationRun(fixture.db as never, {
      workflowKey: "follow_up_scheduler",
      idempotencyKey: "request-1",
      triggerSource: "test",
      dryRun: true,
      referenceDate: "2026-09-08",
    });

    expect(result).toEqual({ claimed: false, existing });
    expect(fixture.select).toHaveBeenCalledOnce();
  });

  it("does not hide non-conflict database failures", async () => {
    const fixture = claimDb({ insertError: { code: "42501", message: "permission denied" } });
    await expect(claimAutomationRun(fixture.db as never, {
      workflowKey: "follow_up_scheduler",
      idempotencyKey: "request-1",
      triggerSource: "test",
      dryRun: true,
      referenceDate: "2026-09-08",
    })).rejects.toThrow("permission denied");
  });
});

describe("automation run finalization", () => {
  it("only finalizes the still-running claimed row", async () => {
    const maybeSingle = vi.fn(async () => ({ data: { id: "run-1" }, error: null }));
    const select = vi.fn(() => ({ maybeSingle }));
    const secondEq = vi.fn(() => ({ select }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const update = vi.fn(() => ({ eq: firstEq }));
    const db = { from: vi.fn(() => ({ update })) };

    await finishAutomationRun(db as never, "run-1", {
      status: "succeeded",
      candidateCount: 5,
      processedCount: 5,
      failureCount: 0,
      summary: { sentCount: 5 },
    });

    expect(firstEq).toHaveBeenCalledWith("id", "run-1");
    expect(secondEq).toHaveBeenCalledWith("status", "running");
  });

  it("refuses to overwrite a row that is no longer running", async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const db = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({ maybeSingle })),
            })),
          })),
        })),
      })),
    };

    await expect(finishAutomationRun(db as never, "run-1", {
      status: "succeeded",
      candidateCount: 0,
      processedCount: 0,
      failureCount: 0,
      summary: {},
    })).rejects.toThrow("claim sudah tidak aktif");
  });
});
