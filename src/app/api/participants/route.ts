import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createParticipantSchema } from "@/lib/transformation/schemas";
import { createParticipant, getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const organizationId = req.nextUrl.searchParams.get("organization_id");
  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  const db = getDb();

  if (engagementId) {
    const { data, error } = await db
      .from("engagement_participants")
      .select("*, participant:participants(*)")
      .eq("engagement_id", engagementId)
      .order("assigned_at", { ascending: false });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, participants: data || [] });
  }

  let query = db.from("participants").select("*").order("created_at", { ascending: false }).limit(100);
  if (organizationId) query = query.eq("organization_id", organizationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, participants: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Client tidak dapat membuat participant." }, { status: 403 });
  }

  const parsed = createParticipantSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const participant = await createParticipant(getDb(), parsed.data);
    return NextResponse.json({ success: true, participant }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat participant." }, { status: 500 });
  }
}
