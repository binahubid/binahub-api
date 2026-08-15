import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { submitReflectionSchema } from "@/lib/transformation/schemas";
import { getDb, submitReflection } from "@/lib/transformation/service";
import { assertCanAccessEngagement, assertCanAccessParticipant, transformationErrorResponse } from "@/lib/transformation/access";

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = submitReflectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const db = getDb();
    await assertCanAccessEngagement(db, actor, parsed.data.engagementId);
    await assertCanAccessParticipant(db, actor, parsed.data.participantId, parsed.data.engagementId);
    const result = await submitReflection(db, actor, parsed.data);
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message || "Gagal submit reflection." }, { status: failure.status });
  }
}
