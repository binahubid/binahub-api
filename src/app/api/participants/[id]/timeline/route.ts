import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb, getParticipantTimeline } from "@/lib/transformation/service";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  try {
    const { id } = await context.params;
    const engagementId = req.nextUrl.searchParams.get("engagement_id") || undefined;
    const timeline = await getParticipantTimeline(getDb(), id, engagementId);
    return NextResponse.json({ success: true, timeline });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat timeline." }, { status: 500 });
  }
}
