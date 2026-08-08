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

const assignSchema = z.object({
  facilitatorId: z.string().uuid(),
  teamId: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  let assignedTeamIds: string[] | null = null;

  // If facilitator (not admin), filter by assigned teams
  if (auth.role === "facilitator") {
    const { data: assignedTeams, error: assignmentError } = await db
      .from("tbos_facilitator_teams")
      .select("team_id")
      .eq("profile_id", auth.userId);

    if (assignmentError) {
      console.error("[T-BOS Teams] Assignment query failed:", assignmentError);
      return NextResponse.json(
        { success: false, error: "Gagal memuat penugasan tim.", detail: assignmentError.message },
        { status: 500 }
      );
    }

    assignedTeamIds = (assignedTeams || []).map((team) => team.team_id);

    if (assignedTeamIds.length === 0) {
      return NextResponse.json({ success: true, teams: [] });
    }
  }

  // Keep team and member queries separate. This prevents a stale PostgREST
  // relationship cache from making the whole team list unavailable.
  let teamsQuery = db
    .from("tbos_teams")
    .select("id, name, batch, organization_id, created_at")
    .order("batch", { ascending: true })
    .order("name", { ascending: true });

  if (assignedTeamIds) {
    teamsQuery = teamsQuery.in("id", assignedTeamIds);
  }

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

  const teams = (teamRows || []).map((team) => ({
    id: team.id,
    name: team.name,
    batch: team.batch,
    organization_id: team.organization_id,
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

  // Check if this is a team creation or facilitator assignment
  if (body.facilitatorId && body.teamId) {
    // Facilitator assignment
    const parsed = assignSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Validasi gagal", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const { facilitatorId, teamId } = parsed.data;
    const db = createServerSupabase();

    const [{ data: facilitator }, { data: team }] = await Promise.all([
      db.from("profiles").select("id, role").eq("id", facilitatorId).maybeSingle(),
      db.from("tbos_teams").select("id").eq("id", teamId).maybeSingle(),
    ]);

    if (!facilitator || facilitator.role !== "facilitator") {
      return NextResponse.json({ success: false, error: "Akun yang dipilih bukan fasilitator." }, { status: 400 });
    }
    if (!team) {
      return NextResponse.json({ success: false, error: "Tim tidak ditemukan." }, { status: 404 });
    }

    const { data, error } = await db
      .from("tbos_facilitator_teams")
      .upsert({
        profile_id: facilitatorId,
        team_id: teamId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, assignment: data });
  }

  // Team creation
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
