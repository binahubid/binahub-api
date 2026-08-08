import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { requireFacilitator } from "@/lib/facilitator-auth";

const teamSchema = z.object({
  name: z.string().min(1).max(50),
  batch: z.enum(["Batch 1", "Batch 2"]),
  organizationId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  const { data, error } = await db
    .from("tbos_teams")
    .select(`
      id,
      name,
      batch,
      organization_id,
      created_at,
      tbos_team_members (
        profile_id,
        member_name
      )
    `)
    .order("batch", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, teams: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const parsed = teamSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const db = createServerSupabase();
  const { name, batch, organizationId } = parsed.data;

  const { data, error } = await db
    .from("tbos_teams")
    .insert({
      name,
      batch,
      organization_id: organizationId || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, team: data });
}
