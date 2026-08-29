import { NextRequest, NextResponse } from "next/server";
import { getBearerToken } from "@/lib/auth-role";
import { createServerSupabase } from "@/lib/supabase";

const WORKFLOW_KEY = "acquisition_batch_processor";

export async function GET(req: NextRequest) {
  const secret = process.env.ACQUISITION_CRON_SECRET;
  if (!secret || getBearerToken(req.headers.get("authorization")) !== secret) {
    return NextResponse.json({ success: false, error: "Akses acquisition processor tidak valid." }, { status: 403 });
  }
  const dryRun = process.env.ACQUISITION_DRY_RUN !== "false";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
  const key = req.headers.get("x-idempotency-key")?.trim() || `${today}:${dryRun ? "dry" : "live"}`;
  if (key.length > 200) return NextResponse.json({ success: false, error: "Idempotency key terlalu panjang." }, { status: 400 });
  const db = createServerSupabase();
  const { data: existing } = await db.from("automation_runs").select("*").eq("workflow_key", WORKFLOW_KEY).eq("idempotency_key", key).maybeSingle();
  if (existing) return NextResponse.json({ success: true, duplicate: true, run: existing });
  const { data: run, error: runError } = await db.from("automation_runs").insert({ workflow_key: WORKFLOW_KEY, idempotency_key: key, trigger_source: "n8n", dry_run: dryRun, status: "running", reference_date: today }).select("id").single();
  if (runError || !run) {
    if (runError?.code === "23505") return NextResponse.json({ success: true, duplicate: true });
    return NextResponse.json({ success: false, error: runError?.message || "Gagal mencatat acquisition run." }, { status: 500 });
  }
  const { data: batches, error: batchError } = await db.from("prospect_import_batches").select("id").eq("status", "approved").order("created_at").limit(25);
  if (batchError) {
    await db.from("automation_runs").update({ status: "failed", failure_count: 1, error_message: batchError.message, finished_at: new Date().toISOString() }).eq("id", run.id);
    return NextResponse.json({ success: false, error: batchError.message, runId: run.id }, { status: 500 });
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
  const summary = { success: failures.length === 0, dryRun, batchCount: (batches || []).length, candidateCount: candidates, promotedCount: promoted, results, failures };
  await db.from("automation_runs").update({ status, candidate_count: candidates, processed_count: promoted, failure_count: failures.length, summary, error_message: failures[0]?.error || null, finished_at: new Date().toISOString() }).eq("id", run.id);
  return NextResponse.json({ ...summary, runId: run.id }, { status: failures.length && !results.length ? 500 : 200 });
}
