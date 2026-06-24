import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { updateEngagementStatusSchema } from "@/lib/transformation/schemas";
import { getDb } from "@/lib/transformation/service";

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Client tidak dapat mengubah status engagement." }, { status: 403 });
  }

  const parsed = updateEngagementStatusSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  const { id } = await context.params;
  const { data, error } = await getDb()
    .from("engagements")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, engagement: data });
}
