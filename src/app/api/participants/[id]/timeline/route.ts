import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb, getParticipantTimeline } from "@/lib/transformation/service";
import { assertCanAccessParticipant, transformationErrorResponse } from "@/lib/transformation/access";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  try {
    const { id } = await context.params;
    const engagementId = req.nextUrl.searchParams.get("engagement_id") || undefined;
    const db = getDb();
    await assertCanAccessParticipant(db, actor, id, engagementId);
    const timeline = await getParticipantTimeline(db, id, engagementId);
    return NextResponse.json({ success: true, timeline });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message || "Gagal memuat timeline." }, { status: failure.status });
  }
}
