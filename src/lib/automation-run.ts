import type { createServerSupabase } from "@/lib/supabase";

type AutomationDb = ReturnType<typeof createServerSupabase>;

export type AutomationRunRecord = {
  id: string;
  status: string;
  dry_run: boolean;
  candidate_count: number;
  processed_count: number;
  failure_count: number;
  summary: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

export type AutomationRunClaim =
  | { claimed: true; runId: string }
  | { claimed: false; existing: AutomationRunRecord | null };

export async function claimAutomationRun(
  db: AutomationDb,
  input: {
    workflowKey: string;
    idempotencyKey: string;
    triggerSource: string;
    dryRun: boolean;
    referenceDate: string;
    startedAt?: string;
  },
): Promise<AutomationRunClaim> {
  const startedAt = input.startedAt || new Date().toISOString();
  const { data, error } = await db.from("automation_runs").insert({
    workflow_key: input.workflowKey,
    idempotency_key: input.idempotencyKey,
    trigger_source: input.triggerSource,
    dry_run: input.dryRun,
    status: "running",
    reference_date: input.referenceDate,
    started_at: startedAt,
  }).select("id").single();

  if (!error && data?.id) return { claimed: true, runId: String(data.id) };
  if (error?.code !== "23505") {
    throw new Error(error?.message || "Automation run gagal diklaim.");
  }

  const { data: existing, error: existingError } = await db.from("automation_runs")
    .select("id, status, dry_run, candidate_count, processed_count, failure_count, summary, started_at, finished_at")
    .eq("workflow_key", input.workflowKey)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  return { claimed: false, existing: (existing || null) as AutomationRunRecord | null };
}

export async function finishAutomationRun(
  db: AutomationDb,
  runId: string,
  input: {
    status: "succeeded" | "partial" | "failed" | "deferred";
    candidateCount: number;
    processedCount: number;
    failureCount: number;
    summary: Record<string, unknown>;
    errorMessage?: string | null;
  },
) {
  const { data, error } = await db.from("automation_runs").update({
    status: input.status,
    candidate_count: input.candidateCount,
    processed_count: input.processedCount,
    failure_count: input.failureCount,
    summary: input.summary,
    error_message: input.errorMessage || null,
    finished_at: new Date().toISOString(),
  }).eq("id", runId).eq("status", "running").select("id").maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Automation run tidak dapat diselesaikan karena claim sudah tidak aktif.");
}
