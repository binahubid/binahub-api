import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

const teamSchema = z.object({
  name: z.string().min(1).max(50),
  batchId: z.string().uuid(),
  organizationId: z.string().uuid().optional(),
  programId: z.string().uuid(),
});

interface TeamRow {
  id: string;
  name: string;
  batch: string;
  batch_id: string | null;
  organization_id: string | null;
  engagement_id: string;
  created_at: string;
  batches: { name: string } | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }
  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 403 });
  }

  let teamsQuery = db
    .from("tbos_teams")
    .select(`
      id, name, batch, organization_id, engagement_id, created_at, batch_id,
      batches ( id, name )
    `)
    .order("name", { ascending: true });

  if (auth.role === "facilitator") {
    const { data: assignments, error: assignmentError } = await db
      .from("facilitator_missions")
      .select("program_id")
      .eq("profile_id", auth.userId)
      .eq("program_id", programId);

    if (assignmentError) {
      console.error("[T-BOS Teams] Assignment query failed:", assignmentError);
      return NextResponse.json(
        { success: false, error: "Gagal memuat penugasan fasilitator.", detail: assignmentError.message },
        { status: 500 }
      );
    }

    if (!assignments?.length) {
      return NextResponse.json({ success: false, error: "Program di luar cakupan fasilitator." }, { status: 403 });
    }
  }
  teamsQuery = teamsQuery.eq("engagement_id", programId);

  const { data: teamRows, error: teamsError } = await teamsQuery;

  if (teamsError) {
    console.error("[T-BOS Teams] Team query failed:", teamsError);
    return NextResponse.json(
      { success: false, error: "Gagal memuat data tim.", detail: teamsError.message },
      { status: 500 }
    );
  }

  const teamIds = (teamRows || []).map((team) => team.id);
  const membersByTeam = new Map<string, Array<{
    id: string;
    profile_id: string | null;
    member_name: string;
    is_captain: boolean;
  }>>();
  let warning: string | undefined;

  if (teamIds.length > 0) {
    const { data: memberRows, error: membersError } = await db
      .from("tbos_team_members")
      .select("id, team_id, profile_id, member_name, is_captain")
      .in("team_id", teamIds)
      .order("is_captain", { ascending: false })
      .order("member_name", { ascending: true });

    if (membersError) {
      console.error("[T-BOS Teams] Member query failed:", membersError);
      warning = `Daftar tim dimuat, tetapi anggota belum tersedia: ${membersError.message}`;
    } else {
      for (const member of memberRows || []) {
        const current = membersByTeam.get(member.team_id) || [];
        current.push({
          id: member.id,
          profile_id: member.profile_id,
          member_name: member.member_name,
          is_captain: member.is_captain,
        });
        membersByTeam.set(member.team_id, current);
      }
    }
  }

  const teams = ((teamRows || []) as unknown as TeamRow[]).map((team) => ({
    id: team.id,
    name: team.name,
    batch: team.batch,
    batchId: team.batch_id,
    batchName: team.batches?.name || team.batch,
    organization_id: team.organization_id,
    engagement_id: team.engagement_id,
    created_at: team.created_at,
    members: membersByTeam.get(team.id) || [],
  }));

  return NextResponse.json({ success: true, teams, warning });
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
  const { name, batchId, organizationId, programId } = parsed.data;

  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }

  const { data: batch, error: batchError } = await db
    .from("batches")
    .select("id, name")
    .eq("id", batchId)
    .eq("program_id", programId)
    .maybeSingle();

  if (batchError || !batch) {
    return NextResponse.json(
      { success: false, error: "Batch tidak ditemukan untuk program ini." },
      { status: 400 }
    );
  }

  const { data, error } = await db
    .from("tbos_teams")
    .insert({
      name,
      batch: batch.name,
      batch_id: batchId,
      organization_id: organizationId || null,
      engagement_id: programId,
    })
    .select()
    .single();

  if (error) {
    const duplicate = error.code === "23505";
    return NextResponse.json(
      { success: false, error: duplicate ? "Nama tim sudah dipakai, gunakan nama lain." : error.message },
      { status: duplicate ? 409 : 500 },
    );
  }

  return NextResponse.json({ success: true, team: data });
}
