import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const addMemberSchema = z.object({
  teamId: z.string().uuid(),
  memberName: z.string().min(1).max(100),
  isCaptain: z.boolean().optional().default(false),
});

const updateCaptainSchema = z.object({
  teamId: z.string().uuid(),
  memberId: z.string().uuid(),
  isCaptain: z.boolean(),
});

async function canManageTeam(db: ReturnType<typeof createServerSupabase>, userId: string, role: string, teamId: string) {
  if (role === "admin") return true;
  const { data } = await db
    .from("tbos_facilitator_teams")
    .select("team_id")
    .eq("profile_id", userId)
    .eq("team_id", teamId)
    .maybeSingle();
  return Boolean(data);
}

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
  if (!(await canManageTeam(db, auth.userId, auth.role, teamId))) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }
  const { data, error } = await db
    .from("tbos_team_members")
    .select("id, profile_id, member_name, is_captain")
    .eq("team_id", teamId)
    .order("is_captain", { ascending: false })
    .order("member_name", { ascending: true });

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

  const { teamId, memberName, isCaptain } = parsed.data;
  const db = createServerSupabase();

  if (!(await canManageTeam(db, auth.userId, auth.role, teamId))) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }

  // If setting as captain, first remove captain from other members
  if (isCaptain) {
    await db
      .from("tbos_team_members")
      .update({ is_captain: false })
      .eq("team_id", teamId);
  }

  // Insert member
  const { data, error } = await db
    .from("tbos_team_members")
    .insert({
      team_id: teamId,
      member_name: memberName.trim(),
      is_captain: isCaptain,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true, member: data });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateCaptainSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "teamId, memberId, dan isCaptain wajib diisi." }, { status: 400 });
  }

  const { teamId, memberId, isCaptain } = parsed.data;
  const db = createServerSupabase();

  if (!(await canManageTeam(db, auth.userId, auth.role, teamId))) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }

  const { error } = await db.rpc("tbos_set_team_captain", {
    p_team_id: teamId,
    p_member_id: memberId,
    p_is_captain: isCaptain,
  });

  if (error) {
    const status = error.code === "23503" ? 404 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(req.url);
  const teamId = searchParams.get("teamId");
  const memberId = searchParams.get("memberId");

  if (!teamId || !memberId) {
    return NextResponse.json({ success: false, error: "teamId dan memberId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  if (!(await canManageTeam(db, auth.userId, auth.role, teamId))) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }
  const { error } = await db
    .from("tbos_team_members")
    .delete()
    .eq("team_id", teamId)
    .eq("id", memberId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
