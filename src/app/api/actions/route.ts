import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createActionSchema } from "@/lib/transformation/schemas";
import { createAction, getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  const participantId = req.nextUrl.searchParams.get("participant_id");
  let query = getDb().from("actions").select("*").order("created_at", { ascending: false }).limit(100);

  if (actor.role === "client" && actor.participantId) {
    query = query.eq("participant_id", actor.participantId);
  } else {
    if (engagementId) query = query.eq("engagement_id", engagementId);
    if (participantId) query = query.eq("participant_id", participantId);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, actions: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = createActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const action = await createAction(getDb(), actor, parsed.data);
    return NextResponse.json({ success: true, action }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat action." }, { status: 500 });
  }
}
