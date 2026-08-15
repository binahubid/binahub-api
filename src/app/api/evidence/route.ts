import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createEvidenceSchema } from "@/lib/transformation/schemas";
import { createEvidence, getDb } from "@/lib/transformation/service";
import { assertCanAccessEngagement, assertCanAccessParticipant, getAccessibleProgramIds, transformationErrorResponse } from "@/lib/transformation/access";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  const participantId = req.nextUrl.searchParams.get("participant_id");
  const db = getDb();
  let query = db.from("evidence").select("*").order("created_at", { ascending: false }).limit(100);

  try {
    const programIds = await getAccessibleProgramIds(db, actor);
    if (programIds?.length === 0) return NextResponse.json({ success: true, evidence: [] });
    if (programIds) query = query.in("engagement_id", programIds);
    if (engagementId) {
      await assertCanAccessEngagement(db, actor, engagementId);
      query = query.eq("engagement_id", engagementId);
    }
    if (actor.role === "client") {
      if (!actor.participantId) return NextResponse.json({ success: true, evidence: [] });
      query = query.eq("participant_id", actor.participantId);
    } else if (participantId) {
      await assertCanAccessParticipant(db, actor, participantId, engagementId || undefined);
      query = query.eq("participant_id", participantId);
    }
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message }, { status: failure.status });
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, evidence: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = createEvidenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const db = getDb();
    await assertCanAccessEngagement(db, actor, parsed.data.engagementId);
    if (actor.role === "client" && !parsed.data.participantId) {
      return NextResponse.json({ success: false, error: "Participant wajib untuk evidence client." }, { status: 400 });
    }
    if (parsed.data.participantId) {
      await assertCanAccessParticipant(db, actor, parsed.data.participantId, parsed.data.engagementId);
    }
    const evidence = await createEvidence(db, actor, parsed.data);
    return NextResponse.json({ success: true, evidence }, { status: 201 });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message || "Gagal membuat evidence." }, { status: failure.status });
  }
}
