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

  // For facilitators: only return teams they are assigned to
  // For admins: return all teams
  let query = db
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

  // If facilitator (not admin), filter by assigned teams
  if (auth.role === "facilitator") {
    const { data: assignedTeams } = await db
      .from("tbos_facilitator_teams")
      .select("team_id")
      .eq("profile_id", auth.userId);

    const assignedTeamIds = (assignedTeams || []).map((t: any) => t.team_id);

    if (assignedTeamIds.length > 0) {
      query = query.in("id", assignedTeamIds);
    } else {
      // No teams assigned - return empty
      return NextResponse.json({ success: true, teams: [] });
    }
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Transform: rename Supabase relation `tbos_team_members` → `members` to match frontend TbosDbTeam interface
  const teams = (data || []).map((t: any) => ({
    id: t.id,
    name: t.name,
    batch: t.batch,
    organization_id: t.organization_id,
    created_at: t.created_at,
    members: t.tbos_team_members || [],
  }));

  return NextResponse.json({ success: true, teams });
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
