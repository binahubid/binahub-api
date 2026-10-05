import { NextRequest, NextResponse } from "next/server";
import { requireWorker } from "@/lib/transformation/auth";
import { createServerSupabase } from "@/lib/supabase";
import { createAndSendAutomaticPreliminary } from "@/lib/automatic-preliminary";

export const runtime = "nodejs";
export const maxDuration = 120;

// Recovery for recorded requests if a server restarts or a transient failure
// interrupts after(). Enable only when its scheduler is intentionally set up.
export async function POST(req: NextRequest) {
  const worker = requireWorker(req);
  if ("error" in worker) return NextResponse.json({ success: false, error: worker.error }, { status: worker.status });
  if (process.env.STANDARD_PROPOSAL_RETRY_ENABLED !== "true") return NextResponse.json({ success: false, code: "STANDARD_PROPOSAL_RETRY_DISABLED" }, { status: 423 });
  const db = createServerSupabase();
  const before = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const pending = await db.from("assessments").select("id,proposal_requested_at")
    .in("proposal_status", ["Diminta", "Gagal Otomatis"]).is("proposal_sent_at", null)
    .lte("proposal_requested_at", before).order("proposal_requested_at").limit(10);
  if (pending.error) return NextResponse.json({ success: false, error: "Antrean proposal belum dapat dibaca." }, { status: 503 });
  for (const row of pending.data || []) {
    const failures = await db.from("email_failures").select("id", { count: "exact", head: true }).eq("target_type", "assessment_preliminary").eq("target_id", row.id);
    if (failures.error) return NextResponse.json({ success: false, error: "Riwayat retry belum dapat dibaca." }, { status: 503 });
    if ((failures.count || 0) >= 3) continue;
    try {
      const result = await createAndSendAutomaticPreliminary(row.id, row.proposal_requested_at);
      return NextResponse.json({ success: true, processed: 1, outcome: result.outcome });
    } catch {
      return NextResponse.json({ success: false, processed: 1, code: "STANDARD_PROPOSAL_RETRY_FAILED" }, { status: 502 });
    }
  }
  return NextResponse.json({ success: true, processed: 0 });
}
