import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb, recalculateParticipantCapabilities } from "@/lib/transformation/service";

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
    const capabilities = await recalculateParticipantCapabilities(getDb(), participantId);
    return NextResponse.json({ success: true, capabilities });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal recalculate capability." }, { status: 500 });
  }
}
