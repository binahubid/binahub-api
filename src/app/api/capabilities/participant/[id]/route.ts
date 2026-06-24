import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { getDb } from "@/lib/transformation/service";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  const { id } = await context.params;
  const { data, error } = await getDb()
    .from("participant_capabilities")
    .select("*, capability:capabilities(*), evidence:capability_evidence(*, evidence:evidence(*))")
    .eq("participant_id", id)
    .order("last_updated", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, capabilities: data || [] });
}
