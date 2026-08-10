import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const updateSchema = z.object({ name: z.string().trim().min(1).max(50).optional(), batch: z.enum(["Batch 1", "Batch 2"]).optional(), programId: z.string().uuid().optional() });

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });
  const { data, error } = await createServerSupabase().from("tbos_teams").update({
    ...(parsed.data.name === undefined ? {} : { name: parsed.data.name }),
    ...(parsed.data.batch === undefined ? {} : { batch: parsed.data.batch }),
    ...(parsed.data.programId === undefined ? {} : { engagement_id: parsed.data.programId }),
  }).eq("id", id).select().single();
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, team: data });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const db = createServerSupabase();
  const { count, error: countError } = await db.from("tbos_observations").select("id", { count: "exact", head: true }).eq("team_id", id);
  if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  if ((count || 0) > 0) return NextResponse.json({ success: false, error: "Tim memiliki histori observasi dan tidak dapat dihapus. Arsipkan programnya." }, { status: 409 });
  const { error } = await db.from("tbos_teams").delete().eq("id", id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
