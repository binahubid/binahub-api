import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

const memberInputSchema = z.object({
  memberName: z.string().trim().min(1).max(100),
  isCaptain: z.boolean().optional().default(false),
});

const addMemberSchema = z.object({
  teamId: z.string().uuid(),
  memberName: z.string().trim().min(1).max(100),
  isCaptain: z.boolean().optional().default(false),
});

const addMembersSchema = z.object({
  teamId: z.string().uuid(),
  members: z.array(memberInputSchema).min(1).max(40),
});

const updateCaptainSchema = z.object({
  teamId: z.string().uuid(),
  memberId: z.string().uuid(),
  isCaptain: z.boolean(),
});

interface TeamAccess {
  canAccess: boolean;
  canEditRoster: boolean;
  teamId: string;
}

async function getTeamAccess(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  role: string,
  teamId: string,
): Promise<TeamAccess> {
  const { data: team } = await db
    .from("tbos_teams")
    .select("id, engagement_id, roster_initialized_by, roster_initialized_at")
    .eq("id", teamId)
    .maybeSingle();
  if (!team?.engagement_id) return { canAccess: false, canEditRoster: false, teamId };
  if (!(await isProgramModuleEnabled(db, team.engagement_id, "tbos"))) {
    return { canAccess: false, canEditRoster: false, teamId };
  }
  if (role === "admin") return { canAccess: true, canEditRoster: true, teamId };
  const { data } = await db
    .from("facilitator_program_assignments")
    .select("selected_mission_id")
    .eq("profile_id", userId)
    .eq("program_id", team.engagement_id)
    .not("selected_mission_id", "is", null)
    .maybeSingle();
  const canAccess = Boolean(data?.selected_mission_id);
  return {
    canAccess,
    canEditRoster: canAccess
      && !team.roster_initialized_at
      && (!team.roster_initialized_by || team.roster_initialized_by === userId),
    teamId,
  };
}

async function claimRoster(
  db: ReturnType<typeof createServerSupabase>,
  userId: string,
  role: string,
  teamId: string,
) {
  if (role === "admin") return true;
  const { data, error } = await db
    .from("tbos_teams")
    .update({ roster_initialized_by: userId })
    .eq("id", teamId)
    .is("roster_initialized_by", null)
    .is("roster_initialized_at", null)
    .select("id")
    .maybeSingle();
  if (error) return false;
  if (data) return true;
  return (await getTeamAccess(db, userId, role, teamId)).canEditRoster;
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
  const access = await getTeamAccess(db, auth.userId, auth.role, teamId);
  if (!access.canAccess) {
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

  return NextResponse.json({
    success: true,
    members: data || [],
    canEditRoster: access.canEditRoster,
    rosterLocked: !access.canEditRoster,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => null);
  const bulkParsed = addMembersSchema.safeParse(body);
  const singleParsed = addMemberSchema.safeParse(body);
  if (!bulkParsed.success && !singleParsed.success) {
    return NextResponse.json({ success: false, error: "Nama peserta dan teamId wajib diisi." }, { status: 400 });
  }

  let teamId: string;
  let requestedMembers: Array<{ memberName: string; isCaptain: boolean }>;
  if (bulkParsed.success) {
    teamId = bulkParsed.data.teamId;
    requestedMembers = bulkParsed.data.members;
  } else if (singleParsed.success) {
    teamId = singleParsed.data.teamId;
    requestedMembers = [{ memberName: singleParsed.data.memberName, isCaptain: singleParsed.data.isCaptain }];
  } else {
    return NextResponse.json({ success: false, error: "Nama peserta dan teamId wajib diisi." }, { status: 400 });
  }
  const normalizedNames = new Set<string>();
  for (const member of requestedMembers) {
    const identity = member.memberName.replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID");
    if (normalizedNames.has(identity)) {
      return NextResponse.json({ success: false, error: `Nama ${member.memberName} tercantum lebih dari sekali.` }, { status: 400 });
    }
    normalizedNames.add(identity);
  }
  if (requestedMembers.filter((member) => member.isCaptain).length > 1) {
    return NextResponse.json({ success: false, error: "Pilih tepat satu kapten tim." }, { status: 400 });
  }
  const db = createServerSupabase();

  const access = await getTeamAccess(db, auth.userId, auth.role, teamId);
  if (!access.canAccess) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }
  if (!access.canEditRoster || !(await claimRoster(db, auth.userId, auth.role, teamId))) {
    return NextResponse.json({ success: false, error: "Roster tim sudah dikunci oleh kunjungan pos pertama." }, { status: 409 });
  }

  const { data: existingMembers, error: existingError } = await db
    .from("tbos_team_members")
    .select("id, member_name, is_captain")
    .eq("team_id", teamId);
  if (existingError) {
    return NextResponse.json({ success: false, error: existingError.message }, { status: 500 });
  }

  const existingNames = new Set(
    (existingMembers || []).map((member) => member.member_name.replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID")),
  );
  const duplicate = requestedMembers.find((member) => existingNames.has(
    member.memberName.replace(/\s+/g, " ").trim().toLocaleLowerCase("id-ID"),
  ));
  if (duplicate) {
    return NextResponse.json({ success: false, error: `${duplicate.memberName} sudah ada dalam tim.` }, { status: 409 });
  }

  const hasExistingCaptain = (existingMembers || []).some((member) => member.is_captain);
  const requestedCaptainIndex = requestedMembers.findIndex((member) => member.isCaptain);
  const captainIndex = requestedCaptainIndex >= 0
    ? requestedCaptainIndex
    : (!hasExistingCaptain && (existingMembers || []).length === 0 ? 0 : -1);

  if (captainIndex >= 0 && hasExistingCaptain) {
    const { error: captainResetError } = await db
      .from("tbos_team_members")
      .update({ is_captain: false })
      .eq("team_id", teamId);
    if (captainResetError) {
      return NextResponse.json({ success: false, error: captainResetError.message }, { status: 500 });
    }
  }

  const { data, error } = await db
    .from("tbos_team_members")
    .insert(requestedMembers.map((member, index) => ({
      team_id: teamId,
      member_name: member.memberName.replace(/\s+/g, " ").trim(),
      is_captain: index === captainIndex,
    })))
    .select("id, profile_id, member_name, is_captain");

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    members: data || [],
    member: data?.[0] || null,
    addedCount: data?.length || 0,
  });
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

  const access = await getTeamAccess(db, auth.userId, auth.role, teamId);
  if (!access.canAccess) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }
  if (!access.canEditRoster) {
    return NextResponse.json({ success: false, error: "Roster tim sudah dikunci oleh kunjungan pos pertama." }, { status: 409 });
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
  const access = await getTeamAccess(db, auth.userId, auth.role, teamId);
  if (!access.canAccess) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan ke tim ini." }, { status: 403 });
  }
  if (!access.canEditRoster) {
    return NextResponse.json({ success: false, error: "Roster tim sudah dikunci oleh kunjungan pos pertama." }, { status: 409 });
  }
  const { data: member } = await db
    .from("tbos_team_members")
    .select("is_captain")
    .eq("team_id", teamId)
    .eq("id", memberId)
    .maybeSingle();
  if (member?.is_captain) {
    return NextResponse.json({ success: false, error: "Pilih kapten lain sebelum menghapus anggota ini." }, { status: 409 });
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
