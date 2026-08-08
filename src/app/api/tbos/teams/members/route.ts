import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const addMemberSchema = z.object({
  teamId: z.string().uuid(),
  memberName: z.string().min(1).max(100),
  roleTitle: z.string().max(50).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  if (!teamId) {
    return NextResponse.json({ success: false, error: "teamId parameter is required" }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from("tbos_team_members")
    .select("profile_id, member_name")
    .eq("team_id", teamId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, members: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = addMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Nama peserta dan teamId wajib diisi." }, { status: 400 });
  }

  const { teamId, memberName } = parsed.data;
  const db = createServerSupabase();

  // Insert member into team without requiring participant login
  const { data, error } = await db
    .from("tbos_team_members")
    .insert({
      team_id: teamId,
      member_name: memberName.trim(),
    })
    .select()
    .single();

  if (error) {
    // If unique constraint or duplicate, ignore or return gracefully
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, member: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  const memberName = searchParams.get("memberName");

  if (!teamId || !memberName) {
    return NextResponse.json({ success: false, error: "teamId dan memberName wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { error } = await db
    .from("tbos_team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("member_name", memberName);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
