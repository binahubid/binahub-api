import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";
import { assertCanAccessParticipant, transformationErrorResponse } from "@/lib/transformation/access";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;

  const db = getDb();
  try {
    await assertCanAccessParticipant(db, actor, id);
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message }, { status: failure.status });
  }

  const { data, error } = await db
    .from("participant_capabilities")
    .select("*, capability:capabilities(*), evidence:capability_evidence(*, evidence:evidence(*))")
    .eq("participant_id", id)
    .order("last_updated", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, capabilities: data || [] });
}
