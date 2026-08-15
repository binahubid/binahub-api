import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { updateActionSchema } from "@/lib/transformation/schemas";
import { getDb, updateAction } from "@/lib/transformation/service";
import { assertCanAccessEngagement, assertCanAccessParticipant, transformationErrorResponse } from "@/lib/transformation/access";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = updateActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const db = getDb();
    const { data: existing, error: existingError } = await db
      .from("actions")
      .select("engagement_id, participant_id")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) return NextResponse.json({ success: false, error: "Action tidak ditemukan." }, { status: 404 });
    await assertCanAccessEngagement(db, actor, existing.engagement_id);
    if (existing.participant_id) await assertCanAccessParticipant(db, actor, existing.participant_id, existing.engagement_id);
    const action = await updateAction(db, id, parsed.data, actor);
    return NextResponse.json({ success: true, action });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message || "Gagal update action." }, { status: failure.status });
  }
}
