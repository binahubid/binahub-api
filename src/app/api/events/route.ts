import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";
import { assertCanAccessEngagement, getAccessibleProgramIds, transformationErrorResponse } from "@/lib/transformation/access";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  const db = getDb();
  let query = db.from("event_queue").select("*").order("created_at", { ascending: false }).limit(100);
  try {
    const programIds = await getAccessibleProgramIds(db, actor);
    if (programIds?.length === 0) return NextResponse.json({ success: true, events: [] });
    if (programIds) query = query.in("engagement_id", programIds);
    if (engagementId) {
      await assertCanAccessEngagement(db, actor, engagementId);
      query = query.eq("engagement_id", engagementId);
    }
    if (actor.role === "client") {
      if (!actor.participantId) return NextResponse.json({ success: true, events: [] });
      query = query.eq("participant_id", actor.participantId);
    }
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message }, { status: failure.status });
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, events: data || [] });
}
