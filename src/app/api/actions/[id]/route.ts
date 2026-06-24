import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { updateActionSchema } from "@/lib/transformation/schemas";
import { getDb, updateAction } from "@/lib/transformation/service";

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
    const action = await updateAction(getDb(), id, parsed.data, actor);
    return NextResponse.json({ success: true, action });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal update action." }, { status: 500 });
  }
}
