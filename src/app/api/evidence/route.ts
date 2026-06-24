import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createEvidenceSchema } from "@/lib/transformation/schemas";
import { createEvidence, getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const engagementId = req.nextUrl.searchParams.get("engagement_id");
  const participantId = req.nextUrl.searchParams.get("participant_id");
  let query = getDb().from("evidence").select("*").order("created_at", { ascending: false }).limit(100);

  if (engagementId) query = query.eq("engagement_id", engagementId);
  if (participantId) query = query.eq("participant_id", participantId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, evidence: data || [] });
}

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const parsed = createEvidenceSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const evidence = await createEvidence(getDb(), actor, parsed.data);
    return NextResponse.json({ success: true, evidence }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal membuat evidence." }, { status: 500 });
  }
}
