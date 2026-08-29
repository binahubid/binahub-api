import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { createServerSupabase } from "@/lib/supabase";

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

  const dryRun = process.env.OPERATIONS_DRY_RUN !== "false";
  const idempotencyKey = req.headers.get("x-idempotency-key")?.trim() || `${requestedDate}:${dryRun ? "dry" : "live"}`;
  if (idempotencyKey.length > 200) {
    return NextResponse.json({ success: false, error: "Idempotency key terlalu panjang." }, { status: 400 });
  }

  const db = createServerSupabase();
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

  const { data, error } = await db.rpc("sync_client_operations_tasks", {
    p_actor: "automation:client-operations",
    p_dry_run: dryRun,
    p_reference_date: requestedDate,
  });

  if (error) {
    await db.from("automation_runs").update({
      status: "failed",
      failure_count: 1,
      error_message: error.message,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
    return NextResponse.json({ success: false, dryRun, retried, error: error.message, runId }, { status: 500 });
  }

  const result = (data || {}) as { candidateCount?: number; createdCount?: number };
  await db.from("automation_runs").update({
    status: "succeeded",
    candidate_count: result.candidateCount || 0,
    processed_count: result.createdCount || 0,
    failure_count: 0,
    summary: data || {},
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  return NextResponse.json({ success: true, dryRun, retried, runId, result: data });
}
