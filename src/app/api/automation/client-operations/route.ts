import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { createServerSupabase } from "@/lib/supabase";
import { loadAutomationRuntimeControl } from "@/lib/automation-runtime-control";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORKFLOW_KEY = "client_operations_daily";

export async function GET(req: NextRequest) {
  const secret = process.env.OPERATIONS_CRON_SECRET;
  const token = getBearerToken(req.headers.get("authorization"));
  if (!secret || token !== secret) {
    return NextResponse.json({ success: false, error: "Akses operations scheduler tidak valid." }, { status: 403 });
  }

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const requestedDate = req.nextUrl.searchParams.get("referenceDate") || today;
  if (!ISO_DATE.test(requestedDate)) {
    return NextResponse.json({ success: false, error: "referenceDate harus menggunakan format YYYY-MM-DD." }, { status: 400 });
  }

  const db = createServerSupabase();
  let runtimeControl;
  try {
    runtimeControl = await loadAutomationRuntimeControl(
      db,
      WORKFLOW_KEY,
      process.env.OPERATIONS_DRY_RUN !== "false",
    );
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Runtime control gagal dibaca." }, { status: 503 });
  }
  if (runtimeControl.effectiveMode === "disabled") {
    return NextResponse.json({
      success: false,
      locked: true,
      code: "AUTOMATION_KILL_SWITCH_ACTIVE",
      error: "Client Operations Scheduler dinonaktifkan oleh kill switch database.",
      requestedMode: runtimeControl.requestedMode,
      effectiveMode: runtimeControl.effectiveMode,
    }, { status: 423 });
  }
  const dryRun = runtimeControl.effectiveMode === "dry_run";
  const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || `${requestedDate}:${dryRun ? "dry" : "live"}`;
  if (idempotencyKey.length > 200) {
    return NextResponse.json({ success: false, error: "Idempotency key terlalu panjang." }, { status: 400 });
  }

  const { data: existing } = await db.from("automation_runs")
    .select("id, status, dry_run, candidate_count, processed_count, failure_count, summary, started_at, finished_at")
    .eq("workflow_key", WORKFLOW_KEY)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  let runId: string;
  let retried = false;

  if (existing) {
    if (existing.status !== "failed") {
      return NextResponse.json({ success: true, duplicate: true, run: existing, result: existing.summary });
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
      .eq("status", "failed")
      .select("id")
      .maybeSingle();

    if (retryError) {
      return NextResponse.json({ success: false, error: retryError.message }, { status: 500 });
    }

    if (!claimedRetry) {
      return NextResponse.json({ success: true, duplicate: true, message: "Run sedang diproses oleh worker lain." });
    }

    runId = claimedRetry.id;
    retried = true;
  } else {
    const { data: run, error: runError } = await db.from("automation_runs").insert({
      workflow_key: WORKFLOW_KEY,
      idempotency_key: idempotencyKey,
      trigger_source: "n8n",
      dry_run: dryRun,
      status: "running",
      reference_date: requestedDate,
    }).select("id").single();
    if (runError || !run) {
      if (runError?.code === "23505") {
        return NextResponse.json({ success: true, duplicate: true, message: "Run dengan idempotency key yang sama sedang atau sudah diproses." });
      }
      return NextResponse.json({ success: false, error: runError?.message || "Gagal mencatat automation run." }, { status: 500 });
    }
    runId = run.id;
  }

  const { data: candidateData, error: candidateError } = await db.rpc("sync_client_operations_tasks", {
    p_actor: "automation:client-operations",
    p_dry_run: true,
    p_reference_date: requestedDate,
  });

  if (candidateError) {
    await db.from("automation_runs").update({
      status: "failed",
      failure_count: 1,
      error_message: candidateError.message,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({ success: false, dryRun, retried, error: candidateError.message, runId }, { status: 500 });
  }

  const candidateResult = (candidateData || {}) as { candidateCount?: number; candidates?: Array<Record<string, unknown>> };
  const selectedCandidates = (candidateResult.candidates || []).slice(0, runtimeControl.maximumItemsPerRun);
  let materialized: { createdCount?: number } = { createdCount: 0 };
  if (!dryRun && selectedCandidates.length) {
    const { data: materializedData, error: materializeError } = await db.rpc("create_limited_client_operations_tasks", {
      p_actor: "automation:client-operations",
      p_candidates: selectedCandidates,
    });
    if (materializeError) {
      await db.from("automation_runs").update({
        status: "failed",
        candidate_count: selectedCandidates.length,
        failure_count: 1,
        error_message: materializeError.message,
        finished_at: new Date().toISOString(),
      }).eq("id", runId);
      return NextResponse.json({ success: false, dryRun, retried, error: materializeError.message, runId }, { status: 500 });
    }
    materialized = (materializedData || {}) as { createdCount?: number };
  }
  const result = {
    success: true,
    dryRun,
    referenceDate: requestedDate,
    availableCandidateCount: candidateResult.candidateCount || 0,
    candidateCount: selectedCandidates.length,
    createdCount: materialized.createdCount || 0,
    maximumItemsPerRun: runtimeControl.maximumItemsPerRun,
    candidates: selectedCandidates,
  };
  await db.from("automation_runs").update({
    status: "succeeded",
    candidate_count: result.candidateCount,
    processed_count: result.createdCount,
    failure_count: 0,
    summary: {
      ...result,
      requestedMode: runtimeControl.requestedMode,
      effectiveMode: runtimeControl.effectiveMode,
      runtimeControlVersion: runtimeControl.version,
    },
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  return NextResponse.json({
    success: true,
    dryRun,
    requestedMode: runtimeControl.requestedMode,
    effectiveMode: runtimeControl.effectiveMode,
    runtimeControlVersion: runtimeControl.version,
    retried,
    runId,
    result,
  });
}
