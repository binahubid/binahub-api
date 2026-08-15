import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { assertCanAccessEngagement, transformationErrorResponse } from "@/lib/transformation/access";
import { getDb } from "@/lib/transformation/service";

const querySchema = z.object({
  engagementId: z.string().uuid(),
  type: z.literal("csv"),
});

function csvCell(value: unknown) {
  const raw = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = querySchema.safeParse({
    engagementId: req.nextUrl.searchParams.get("engagement_id"),
    type: req.nextUrl.searchParams.get("type") || "csv",
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Parameter export tidak valid." }, { status: 400 });
  }

  const db = getDb();
  try {
    await assertCanAccessEngagement(db, actor, parsed.data.engagementId);

    const rows: unknown[][] = [];
    if (actor.role === "client") {
      if (!actor.participantId) return NextResponse.json({ success: false, error: "Participant client tidak ditemukan." }, { status: 403 });
      const { data, error } = await db
        .from("participant_capabilities")
        .select("score, trend, evidence_count, last_updated, capabilities ( name )")
        .eq("participant_id", actor.participantId)
        .order("last_updated", { ascending: false });
      if (error) throw new Error(error.message);
      rows.push(["Capability", "Score", "Trend", "Evidence Count", "Last Updated"]);
      for (const item of data || []) {
        const capability = item.capabilities as unknown as { name?: string } | null;
        rows.push([capability?.name || "", item.score, item.trend, item.evidence_count, item.last_updated]);
      }
    } else {
      const { data, error } = await db
        .from("evidence")
        .select("id, participant_id, type, source, capability_tags, confidence_score, content, created_at")
        .eq("engagement_id", parsed.data.engagementId)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw new Error(error.message);
      rows.push(["Evidence ID", "Participant ID", "Type", "Source", "Capability Tags", "Confidence", "Content", "Created At"]);
      for (const item of data || []) {
        rows.push([item.id, item.participant_id, item.type, item.source, item.capability_tags, item.confidence_score, item.content, item.created_at]);
      }
    }

    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\n")}`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="engagement-${parsed.data.engagementId.slice(0, 8)}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message }, { status: failure.status });
  }
}
