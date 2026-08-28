import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorker } from "@/lib/transformation/auth";
import { getDb, processPendingEvents } from "@/lib/transformation/service";

const processSchema = z.object({
  limit: z.number().int().min(1).max(50).optional().default(10),
});

export async function POST(req: NextRequest) {
  const worker = requireWorker(req);
  if ("error" in worker) {
    return NextResponse.json({ success: false, error: worker.error }, { status: worker.status });
  }

  const parsed = processSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const db = getDb();
    if (process.env.TRANSFORMATION_WORKER_DRY_RUN === "true") {
      const { count, error } = await db
        .from("event_queue")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("available_at", new Date().toISOString());
      if (error) throw new Error(error.message);

      return NextResponse.json({
        success: true,
        dryRun: true,
        pendingDue: count || 0,
        processed: [],
      });
    }

    const processed = await processPendingEvents(db, parsed.data.limit);
    return NextResponse.json({ success: true, processed });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memproses event." }, { status: 500 });
  }
}
