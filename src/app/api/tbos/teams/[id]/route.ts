import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  batchId: z.string().uuid().optional(),
  programId: z.string().uuid().optional(),
});

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) return NextResponse.json({ success: false, error: "Payload tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  const { data: existingTeam, error: teamError } = await db
    .from("tbos_teams")
    .select("engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (teamError) return NextResponse.json({ success: false, error: teamError.message }, { status: 500 });
  if (!existingTeam?.engagement_id) return NextResponse.json({ success: false, error: "Tim tidak ditemukan." }, { status: 404 });
  if (!(await isProgramModuleEnabled(db, existingTeam.engagement_id, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }
  const updatePayload: Record<string, string> = {};

  if (parsed.data.name !== undefined) {
    updatePayload.name = parsed.data.name;
  }

  if (parsed.data.batchId !== undefined) {
    const { data: team } = await db
      .from("tbos_teams")
      .select("engagement_id")
      .eq("id", id)
      .maybeSingle();

    const programId = parsed.data.programId || team?.engagement_id;
    if (programId) {
      const { data: batch } = await db
        .from("batches")
        .select("id, name")
        .eq("id", parsed.data.batchId)
        .eq("program_id", programId)
        .maybeSingle();

      if (batch) {
        updatePayload.batch_id = batch.id;
        updatePayload.batch = batch.name;
      }
    }
  }

  if (parsed.data.programId !== undefined) {
    if (parsed.data.programId !== existingTeam.engagement_id) {
      return NextResponse.json({ success: false, error: "Program tim tidak dapat dipindahkan setelah dibuat." }, { status: 409 });
    }
  }

  const { data, error } = await db
    .from("tbos_teams")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, team: data });
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const { id } = await context.params;
  const db = createServerSupabase();
  const { data: team, error: teamError } = await db.from("tbos_teams").select("engagement_id").eq("id", id).maybeSingle();
  if (teamError) return NextResponse.json({ success: false, error: teamError.message }, { status: 500 });
  if (!team?.engagement_id) return NextResponse.json({ success: false, error: "Tim tidak ditemukan." }, { status: 404 });
  if (!(await isProgramModuleEnabled(db, team.engagement_id, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }
  const { count, error: countError } = await db.from("tbos_observations").select("id", { count: "exact", head: true }).eq("team_id", id);
  if (countError) return NextResponse.json({ success: false, error: countError.message }, { status: 500 });
  if ((count || 0) > 0) return NextResponse.json({ success: false, error: "Tim memiliki histori observasi dan tidak dapat dihapus. Arsipkan programnya." }, { status: 409 });
  const { error } = await db.from("tbos_teams").delete().eq("id", id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
