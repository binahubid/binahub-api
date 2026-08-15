import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb, recalculateParticipantCapabilities } from "@/lib/transformation/service";
import { assertCanAccessParticipant, transformationErrorResponse } from "@/lib/transformation/access";

export async function POST(req: NextRequest, context: { params: Promise<{ participantId: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Capability hanya boleh direcalculate oleh sistem/fasilitator/admin." }, { status: 403 });
  }

  try {
    const { participantId } = await context.params;
    const db = getDb();
    await assertCanAccessParticipant(db, actor, participantId);
    const capabilities = await recalculateParticipantCapabilities(db, participantId);
    return NextResponse.json({ success: true, capabilities });
  } catch (error) {
    const failure = transformationErrorResponse(error);
    return NextResponse.json({ success: false, error: failure.message || "Gagal recalculate capability." }, { status: failure.status });
  }
}
