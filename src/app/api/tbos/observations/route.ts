import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const observationSchema = z.object({
  teamId: z.string().uuid().optional(),
  newTeam: z.object({
    name: z.string().min(1).max(50),
    batchId: z.string().uuid(),
    programId: z.string().uuid(),
  }).optional(),
  missionId: z.string().uuid(),
  clientSubmissionId: z.string().min(1).max(128),
  batch: z.string().min(1).max(50).optional(),
  notes: z.string().max(50).optional().default(""),
  scores: z.array(
    z.object({
      dimensionId: z.string().uuid(),
      levelValue: z.number().int().min(1).max(5),
    })
  ).min(1),
  members: z.array(z.object({
    teamMemberId: z.string().uuid().nullable().optional(),
    memberName: z.string().trim().min(1).max(200),
    isPresent: z.boolean(),
    isCaptain: z.boolean(),
  })).min(1),
}).superRefine(({ teamId, newTeam, members }, ctx) => {
  if (!teamId && !newTeam) {
    ctx.addIssue({ code: "custom", path: ["teamId"], message: "teamId atau newTeam wajib diisi." });
  }
  if (!members.some((member) => member.isPresent)) {
    ctx.addIssue({ code: "custom", path: ["members"], message: "Minimal satu anggota harus hadir." });
  }
  if (members.filter((member) => member.isPresent && member.isCaptain).length !== 1 || members.filter((member) => member.isCaptain).length !== 1) {
    ctx.addIssue({ code: "custom", path: ["members"], message: "Harus ada tepat satu kapten yang hadir." });
  }
});

export async function POST(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const parsed = observationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { teamId: inputTeamId, newTeam, missionId, clientSubmissionId, notes, scores, members } = parsed.data;
  const db = createServerSupabase();

  let teamId = inputTeamId;

  if (!teamId && newTeam) {
    const [{ data: facilitator }, { data: batch }] = await Promise.all([
      db.from("profiles").select("id, role").eq("id", auth.userId).maybeSingle(),
      db.from("batches").select("id, name").eq("id", newTeam.batchId).eq("program_id", newTeam.programId).maybeSingle(),
    ]);

    if (!facilitator || (facilitator.role !== "facilitator" && facilitator.role !== "admin")) {
      return NextResponse.json({ success: false, error: "Akun tidak valid." }, { status: 400 });
    }
    if (!batch) {
      return NextResponse.json({ success: false, error: "Batch tidak ditemukan." }, { status: 400 });
    }

    const { data: newTeamRow, error: createError } = await db
      .from("tbos_teams")
      .insert({
        name: newTeam.name.trim(),
        batch: batch.name,
        batch_id: batch.id,
        engagement_id: newTeam.programId,
      })
      .select("id")
      .single();

    if (createError) {
      return NextResponse.json({ success: false, error: `Gagal membuat tim: ${createError.message}` }, { status: 500 });
    }

    teamId = newTeamRow.id;

    const rosterMembers = members
      .filter((m) => m.memberName.trim())
      .map((m) => ({
        team_id: teamId!,
        member_name: m.memberName.trim(),
        is_captain: m.isCaptain,
      }));

    if (rosterMembers.length > 0) {
      await db.from("tbos_team_members").insert(rosterMembers);
    }
  }

  if (!teamId) {
    return NextResponse.json({ success: false, error: "teamId wajib diisi." }, { status: 400 });
  }

  const [{ data: team }, { data: missionAssignment }, { data: missionDimensions }] = await Promise.all([
    db.from("tbos_teams").select("id, batch, engagement_id").eq("id", teamId).maybeSingle(),
    db.from("facilitator_missions").select("mission_id").eq("profile_id", auth.userId).eq("mission_id", missionId).maybeSingle(),
    db.from("tbos_mission_dimensions").select("dimension_id").eq("mission_id", missionId),
  ]);

  if (!team) {
    return NextResponse.json({ success: false, error: "Tim tidak ditemukan." }, { status: 404 });
  }
  if (auth.role !== "admin" && !missionAssignment) {
    return NextResponse.json({ success: false, error: "Anda tidak ditugaskan untuk misi ini." }, { status: 403 });
  }

  if (auth.role !== "admin" && team.engagement_id) {
    const { data: programAssignment } = await db
      .from("facilitator_missions")
      .select("mission_id")
      .eq("profile_id", auth.userId)
      .eq("program_id", team.engagement_id)
      .eq("mission_id", missionId)
      .maybeSingle();

    if (!programAssignment) {
      return NextResponse.json({ success: false, error: "Anda tidak ditugaskan untuk misi ini dalam program ini." }, { status: 403 });
    }
  }

  const requiredDimensionIds = new Set((missionDimensions || []).map((row: any) => row.dimension_id));
  const submittedDimensionIds = scores.map((score) => score.dimensionId);
  if (
    requiredDimensionIds.size === 0 ||
    submittedDimensionIds.length !== requiredDimensionIds.size ||
    new Set(submittedDimensionIds).size !== submittedDimensionIds.length ||
    submittedDimensionIds.some((id) => !requiredDimensionIds.has(id))
  ) {
    return NextResponse.json({ success: false, error: "Nilai dimensi tidak sesuai dengan misi yang dipilih." }, { status: 400 });
  }

  const { data: observationId, error } = await db.rpc("tbos_submit_observation", {
    p_facilitator_id: auth.userId,
    p_team_id: teamId,
    p_mission_id: missionId,
    p_client_submission_id: clientSubmissionId,
    p_notes: notes || null,
    p_scores: scores,
    p_members: members,
    p_is_admin: auth.role === "admin",
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23503" ? 404 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }

  return NextResponse.json({ success: true, observationId });
}

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const programId = req.nextUrl.searchParams.get("programId");
  const url = new URL(req.url);
  const teamId = url.searchParams.get("teamId");
  const missionId = url.searchParams.get("missionId");

  let query = db
    .from("tbos_observations")
    .select(`
      id,
      team_id,
      mission_id,
      profile_id,
      batch,
      observed_at,
      submitted_at,
      status,
      notes,
      locked_at,
      locked_by,
      revision_deadline,
      tbos_teams (
        name
      ),
      tbos_missions (
        code,
        name
      ),
       tbos_observation_scores (
        dimension_id,
        level_value,
        tbos_behavioral_dimensions (
          code,
          name
        )
      ),
      tbos_observation_members (
        id,
        team_member_id,
        member_name,
        is_present,
        is_captain,
        created_at,
        updated_at
      )
    `)
    .order("submitted_at", { ascending: false });

  // Facilitators see only their own observations; admins see all
  if (auth.role !== "admin") {
    query = query.eq("profile_id", auth.userId);
  }

  if (teamId) {
    query = query.eq("team_id", teamId);
  }
  if (missionId) {
    query = query.eq("mission_id", missionId);
  }
  if (programId) {
    const { data: programTeams, error: programTeamsError } = await db.from("tbos_teams").select("id").eq("engagement_id", programId);
    if (programTeamsError) return NextResponse.json({ success: false, error: programTeamsError.message }, { status: 500 });
    const teamIds = (programTeams || []).map((team) => team.id);
    query = teamIds.length > 0 ? query.in("team_id", teamIds) : query.limit(0);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[T-BOS Observations] query error:", JSON.stringify(error));
    return NextResponse.json({ success: false, error: error.message, code: error.code, hint: error.hint, detail: error.details }, { status: 500 });
  }

  const profileIds = [...new Set((data || []).map((observation: any) => observation.profile_id))];
  const { data: profileRows, error: profileError } = profileIds.length > 0
    ? await db.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [], error: null };

  if (profileError) {
    console.error("[T-BOS Observations] profile query error:", JSON.stringify(profileError));
    return NextResponse.json({ success: false, error: profileError.message, code: profileError.code, hint: profileError.hint, detail: profileError.details }, { status: 500 });
  }

  const profilesById = new Map((profileRows || []).map((profile) => [profile.id, profile.full_name]));
  const observations = (data || []).map((obs: any) => ({
    id: obs.id,
    teamId: obs.team_id,
    teamName: obs.tbos_teams?.name || "-",
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "-",
    profileId: obs.profile_id,
    facilitatorName: profilesById.get(obs.profile_id) || "-",
    batch: obs.batch,
    observedAt: obs.observed_at,
    submittedAt: obs.submitted_at,
    status: obs.status,
    notes: obs.notes,
    lockedAt: obs.locked_at,
    lockedBy: obs.locked_by,
    revisionDeadline: obs.revision_deadline,
    canEdit: obs.status === "submitted" && (!obs.revision_deadline || new Date(obs.revision_deadline).getTime() > Date.now()),
    members: (obs.tbos_observation_members || []).map((member: any) => ({
      id: member.id,
      teamMemberId: member.team_member_id,
      memberName: member.member_name,
      isPresent: member.is_present,
      isCaptain: member.is_captain,
      createdAt: member.created_at,
      updatedAt: member.updated_at,
    })),
    scores: (obs.tbos_observation_scores || []).map((s: any) => ({
      dimensionId: s.dimension_id,
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
    })),
  }));

  return NextResponse.json({ success: true, observations });
}
