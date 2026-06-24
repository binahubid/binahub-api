import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { generateInsightSchema } from "@/lib/transformation/schemas";
import { generateInsightDraft, getDb } from "@/lib/transformation/service";

export async function POST(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }

  if (actor.role === "client") {
    return NextResponse.json({ success: false, error: "Insight generation hanya untuk fasilitator/admin/sistem." }, { status: 403 });
  }

  const parsed = generateInsightSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Payload tidak valid." }, { status: 400 });
  }

  try {
    const insight = await generateInsightDraft(getDb(), parsed.data.engagementId, parsed.data.type);
    return NextResponse.json({ success: true, insight }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal generate insight." }, { status: 500 });
  }
}
