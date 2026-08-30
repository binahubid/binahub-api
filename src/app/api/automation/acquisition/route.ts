import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { createServerSupabase } from "@/lib/supabase";
import { loadAutomationRuntimeControl } from "@/lib/automation-runtime-control";

const WORKFLOW_KEY = "acquisition_batch_processor";

export async function GET(req: NextRequest) {
  const secret = process.env.ACQUISITION_CRON_SECRET;
  if (!secret || getBearerToken(req.headers.get("authorization")) !== secret) {
    return NextResponse.json({ success: false, error: "Akses acquisition processor tidak valid." }, { status: 403 });
  }
  const db = createServerSupabase();
  let runtimeControl;
  try {
    runtimeControl = await loadAutomationRuntimeControl(
      db,
      WORKFLOW_KEY,
      process.env.ACQUISITION_DRY_RUN !== "false",
    );
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Runtime control gagal dibaca." }, { status: 503 });
  }
  if (runtimeControl.effectiveMode === "disabled") {
    return NextResponse.json({
      success: false,
      locked: true,
      code: "AUTOMATION_KILL_SWITCH_ACTIVE",
      error: "Acquisition Batch Processor dinonaktifkan oleh kill switch database.",
      requestedMode: runtimeControl.requestedMode,
      effectiveMode: runtimeControl.effectiveMode,
    }, { status: 423 });
  }
  const dryRun = runtimeControl.effectiveMode === "dry_run";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const key = req.headers.get("x-idempotency-key")?.trim() || `${today}:${dryRun ? "dry" : "live"}`;
  if (key.length > 200) return NextResponse.json({ success: false, error: "Idempotency key terlalu panjang." }, { status: 400 });
  const { data: existing } = await db.from("automation_runs").select("*").eq("workflow_key", WORKFLOW_KEY).eq("idempotency_key", key).maybeSingle();
  let runId: string;
  let retried = false;
  if (existing) {
    if (!["failed", "partial"].includes(existing.status)) {
      return NextResponse.json({ success: true, duplicate: true, run: existing });
    }
    const { data: claimedRetry, error: retryError } = await db.from("automation_runs")
      .update({
        status: "running",
        candidate_count: 0,
        processed_count: 0,
        failure_count: 0,
        summary: {},
        error_message: null,
        started_at: new Date().toISOString(),
        finished_at: null,
      })
      .eq("id", existing.id)
      .in("status", ["failed", "partial"])
      .select("id")
      .maybeSingle();
    if (retryError) return NextResponse.json({ success: false, error: retryError.message }, { status: 500 });
    if (!claimedRetry) return NextResponse.json({ success: true, duplicate: true, message: "Run sedang diproses oleh worker lain." });
    runId = claimedRetry.id;
    retried = true;
  } else {
    const { data: run, error: runError } = await db.from("automation_runs").insert({ workflow_key: WORKFLOW_KEY, idempotency_key: key, trigger_source: "n8n", dry_run: dryRun, status: "running", reference_date: today }).select("id").single();
    if (runError || !run) {
      if (runError?.code === "23505") return NextResponse.json({ success: true, duplicate: true });
      return NextResponse.json({ success: false, error: runError?.message || "Gagal mencatat acquisition run." }, { status: 500 });
    }
    runId = run.id;
  }
  const { data: batches, error: batchError } = await db.from("prospect_import_batches").select("id").eq("status", "approved").order("created_at").limit(Math.min(runtimeControl.maximumItemsPerRun, 25));
  if (batchError) {
    await db.from("automation_runs").update({ status: "failed", failure_count: 1, error_message: batchError.message, finished_at: new Date().toISOString() }).eq("id", runId);
    return NextResponse.json({ success: false, retried, error: batchError.message, runId }, { status: 500 });
  }
  const results: unknown[] = [];
  const failures: Array<{ batchId: string; error: string }> = [];
  let candidates = 0;
  let promoted = 0;
  for (const batch of batches || []) {
    const result = await db.rpc("promote_acquisition_batch", { p_batch_id: batch.id, p_actor: "automation:acquisition", p_dry_run: dryRun });
    if (result.error) failures.push({ batchId: batch.id, error: result.error.message });
    else {
      const value = (result.data || {}) as { candidateCount?: number; promotedCount?: number };
      candidates += value.candidateCount || 0;
      promoted += value.promotedCount || 0;
      results.push(result.data);
    }
  }
  const status = failures.length ? (results.length ? "partial" : "failed") : "succeeded";
  const summary = {
    success: failures.length === 0,
    dryRun,
    requestedMode: runtimeControl.requestedMode,
    effectiveMode: runtimeControl.effectiveMode,
    runtimeControlVersion: runtimeControl.version,
    batchCount: (batches || []).length,
    candidateCount: candidates,
    promotedCount: promoted,
    results,
    failures,
  };
  await db.from("automation_runs").update({ status, candidate_count: candidates, processed_count: promoted, failure_count: failures.length, summary, error_message: failures[0]?.error || null, finished_at: new Date().toISOString() }).eq("id", runId);
  return NextResponse.json({ ...summary, retried, runId }, { status: failures.length && !results.length ? 500 : 200 });
}
