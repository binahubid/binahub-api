import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorker } from "@/lib/transformation/auth";
import { getDb, processPendingEvents } from "@/lib/transformation/service";

const processSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export async function POST(req: NextRequest) {
  const runStartedAt = new Date().toISOString();
  const worker = requireWorker(req);
  if ("error" in worker) {
    return NextResponse.json({ success: false, error: worker.error }, { status: worker.status });
  }

  const parsed = processSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  const db = getDb();
  const dryRun = process.env.TRANSFORMATION_WORKER_DRY_RUN === "true";
  const referenceDate = new Date().toISOString().slice(0, 10);
  const idempotencyKey = (req.headers.get("x-idempotency-key")?.trim() || `${referenceDate}:${dryRun ? "dry" : "live"}`).slice(0, 200);
  const recordRun = async (input: {
    status: "succeeded" | "failed";
    candidateCount: number;
    processedCount: number;
    failureCount: number;
    summary: Record<string, unknown>;
    errorMessage?: string | null;
  }) => {
    const { error } = await db.from("automation_runs").upsert({
      workflow_key: "transformation_event_worker",
      idempotency_key: idempotencyKey,
      trigger_source: "n8n",
      dry_run: dryRun,
      status: input.status,
      reference_date: referenceDate,
      candidate_count: input.candidateCount,
      processed_count: input.processedCount,
      failure_count: input.failureCount,
      summary: input.summary,
      error_message: input.errorMessage || null,
      started_at: runStartedAt,
      finished_at: new Date().toISOString(),
    }, { onConflict: "workflow_key,idempotency_key" });
    if (error) console.error("Transformation worker audit gagal:", error.message);
  };

  try {
    if (dryRun) {
      const { count, error } = await db
        .from("event_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("available_at", new Date().toISOString());
      if (error) throw new Error(error.message);

      const pendingDue = count || 0;
      await recordRun({
        status: "succeeded",
        candidateCount: pendingDue,
        processedCount: 0,
        failureCount: 0,
        summary: { pendingDue, processedCount: 0 },
      });
      return NextResponse.json({
        success: true,
        dryRun: true,
        pendingDue,
        processed: [],
      });
    }

    const processed = await processPendingEvents(db, parsed.data.limit);
    const processedCount = Array.isArray(processed) ? processed.length : 0;
    await recordRun({
      status: "succeeded",
      candidateCount: processedCount,
      processedCount,
      failureCount: 0,
      summary: { processedCount },
    });
    return NextResponse.json({ success: true, processed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gagal memproses event.";
    await recordRun({
      status: "failed",
      candidateCount: 0,
      processedCount: 0,
      failureCount: 1,
      summary: {},
      errorMessage: message,
    });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
