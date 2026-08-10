import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { engagementTypeSchema, engagementStatusSchema } from "@/lib/transformation/schemas";
import { getDb } from "@/lib/transformation/service";
import { z } from "zod";

const updateSchema = z.object({
  code: z.string().trim().min(1).max(50).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  type: engagementTypeSchema.optional(),
  status: engagementStatusSchema.optional(),
  startDate: z.string().trim().nullable().optional(),
  endDate: z.string().trim().nullable().optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor || actor.role === "client") {
    return NextResponse.json({ success: false, error: "Akses admin diperlukan." }, { status: "error" in actor ? actor.status : 403 });
  }
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
  const { data, error } = await getDb().from("engagements").update({
    ...(parsed.data.code === undefined ? {} : { code: parsed.data.code.toUpperCase() }),
    ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
    ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
    ...(parsed.data.startDate === undefined ? {} : { start_date: parsed.data.startDate }),
    ...(parsed.data.endDate === undefined ? {} : { end_date: parsed.data.endDate }),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select().single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, engagement: data });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor || actor.role === "client") return NextResponse.json({ success: false, error: "Akses admin diperlukan." }, { status: "error" in actor ? actor.status : 403 });
  const { id } = await context.params;
  const db = getDb();
  const { count, error: countError } = await db.from("tbos_observations").select("id", { count: "exact", head: true }).in("team_id", (await db.from("tbos_teams").select("id").eq("engagement_id", id)).data?.map((team) => team.id) || ["00000000-0000-0000-0000-000000000000"]);
  if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  if ((count || 0) > 0) return NextResponse.json({ success: false, error: "Program memiliki histori observasi dan hanya dapat diarsipkan." }, { status: 409 });
  const { error } = await db.from("engagements").delete().eq("id", id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
