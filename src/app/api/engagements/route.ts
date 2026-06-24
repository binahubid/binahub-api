import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createEngagementSchema } from "@/lib/transformation/schemas";
import { createEngagement, createParticipant, generateAccessCodesForEngagement, getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const organizationId = req.nextUrl.searchParams.get("organization_id");
  const db = getDb();
  let query = db.from("engagements").select("*").order("created_at", { ascending: false }).limit(100);

  if (actor.role === "client" && actor.organizationId) {
    query = query.eq("organization_id", actor.organizationId);
  } else if (organizationId) {
    query = query.eq("organization_id", organizationId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, engagements: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Client tidak dapat membuat engagement." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createEngagementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const db = getDb();
    const engagement = await createEngagement(db, actor, parsed.data);

    const participants = body?.participants as Array<{ name: string; email?: string; role?: string }> | undefined;
    const createdParticipants: Array<{ id: string; name: string }> = [];

    if (participants && participants.length > 0) {
      for (const p of participants) {
        const participant = await createParticipant(db, {
          organizationId: parsed.data.organizationId,
          engagementId: engagement.id,
          name: p.name,
          email: p.email,
          engagementRole: p.role || "participant",
        });
        createdParticipants.push({ id: participant.id, name: p.name });
      }
    }

    let accessCodes: Array<{ code: string; companyName: string; teamName: string; participantId: string }> = [];

    if (createdParticipants.length > 0) {
      const { data: org } = await db.from("organizations").select("name").eq("id", parsed.data.organizationId).single();
      const orgName = org?.name || "Unknown";

      accessCodes = await generateAccessCodesForEngagement(
        db,
        engagement.id,
        parsed.data.organizationId,
        orgName,
        createdParticipants,
      );
    }

    return NextResponse.json({ success: true, engagement, accessCodes }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat engagement." }, { status: 500 });
  }
}
