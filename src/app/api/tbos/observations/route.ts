import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { collectAllPages } from "@/lib/pagination";

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

interface ObservationListRow {
  id: string;
  team_id: string;
  mission_id: string;
  profile_id: string;
  batch: string;
  observed_at: string;
  submitted_at: string;
  status: string;
  notes: string | null;
  locked_at: string | null;
  locked_by: string | null;
  revision_deadline: string | null;
  tbos_teams: { name: string } | null;
  tbos_missions: { code: string; name: string } | null;
  profiles: { full_name: string } | null;
  tbos_observation_scores: Array<{
    dimension_id: string;
    level_value: number;
    tbos_behavioral_dimensions: { code: string; name: string } | null;
  }>;
  tbos_observation_members: Array<{
    id: string;
    team_member_id: string | null;
    member_name: string;
    is_present: boolean;
    is_captain: boolean;
    created_at: string;
    updated_at: string;
  }>;
}

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

  const { teamId, newTeam, missionId, clientSubmissionId, notes, scores, members } = parsed.data;
  const db = createServerSupabase();
  const { data: observationId, error } = await db.rpc("tbos_submit_observation_v2", {
    p_facilitator_id: auth.userId,
    p_team_id: teamId || null,
    p_program_id: newTeam?.programId || null,
    p_batch_id: newTeam?.batchId || null,
    p_team_name: newTeam?.name.trim() || null,
    p_mission_id: missionId,
    p_client_submission_id: clientSubmissionId,
    p_notes: notes || null,
    p_scores: scores,
    p_members: members,
    p_is_admin: auth.role === "admin",
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23503" ? 404 : error.code === "23505" ? 409 : error.code === "22023" ? 400 : 500;
    const message = error.code === "23505"
      ? "Nama tim sudah dipakai, gunakan nama lain atau pilih dari daftar."
      : error.message;
    return NextResponse.json({ success: false, error: message }, { status });
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
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }
  try {
    if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
      return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }
  if (auth.role === "facilitator") {
    const { data: assignment, error: assignmentError } = await db
      .from("facilitator_missions")
      .select("mission_id")
      .eq("profile_id", auth.userId)
      .eq("program_id", programId)
      .limit(1)
      .maybeSingle();
    if (assignmentError) return NextResponse.json({ success: false, error: assignmentError.message }, { status: 500 });
    if (!assignment) return NextResponse.json({ success: false, error: "Program di luar cakupan fasilitator." }, { status: 403 });
  }
  const url = new URL(req.url);
  const teamId = url.searchParams.get("teamId");
  const missionId = url.searchParams.get("missionId");
  if ((teamId && !z.string().uuid().safeParse(teamId).success)
    || (missionId && !z.string().uuid().safeParse(missionId).success)) {
    return NextResponse.json({ success: false, error: "Filter observasi tidak valid." }, { status: 400 });
  }

  let typedRows: ObservationListRow[];
  try {
    typedRows = await collectAllPages<ObservationListRow>((from, to) => {
      let query = db.from("tbos_observations").select(`
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
      profiles (full_name),
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
        .eq("program_id", programId)
        .order("submitted_at", { ascending: false });
      if (auth.role !== "admin") query = query.eq("profile_id", auth.userId);
      if (teamId) query = query.eq("team_id", teamId);
      if (missionId) query = query.eq("mission_id", missionId);
      return query.range(from, to) as never;
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat observasi." }, { status: 500 });
  }
  const observations = typedRows.map((obs) => ({
    id: obs.id,
    teamId: obs.team_id,
    teamName: obs.tbos_teams?.name || "-",
    missionId: obs.mission_id,
    missionCode: obs.tbos_missions?.code || "",
    missionName: obs.tbos_missions?.name || "-",
    profileId: obs.profile_id,
    facilitatorName: obs.profiles?.full_name || "-",
    batch: obs.batch,
    observedAt: obs.observed_at,
    submittedAt: obs.submitted_at,
    status: obs.status,
    notes: obs.notes,
    lockedAt: obs.locked_at,
    lockedBy: obs.locked_by,
    revisionDeadline: obs.revision_deadline,
    canEdit: obs.status === "submitted" && (!obs.revision_deadline || new Date(obs.revision_deadline).getTime() > Date.now()),
    members: (obs.tbos_observation_members || []).map((member) => ({
      id: member.id,
      teamMemberId: member.team_member_id,
      memberName: member.member_name,
      isPresent: member.is_present,
      isCaptain: member.is_captain,
      createdAt: member.created_at,
      updatedAt: member.updated_at,
    })),
    scores: (obs.tbos_observation_scores || []).map((s) => ({
      dimensionId: s.dimension_id,
      dimensionCode: s.tbos_behavioral_dimensions?.code || "",
      dimensionName: s.tbos_behavioral_dimensions?.name || "",
      levelValue: s.level_value,
    })),
  }));

  return NextResponse.json({ success: true, observations });
}
