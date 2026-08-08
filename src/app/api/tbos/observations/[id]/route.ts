import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

const patchSchema = z.object({
  action: z.enum(["lock", "unlock", "edit"]),
  notes: z.string().max(50).optional(),
  scores: z.array(
    z.object({
      dimensionId: z.string().uuid(),
      levelValue: z.number().int().min(1).max(5),
    })
  ).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const db = createServerSupabase();

  const { data: observation, error } = await db
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
      tbos_teams (name),
      tbos_missions (code, name),
       tbos_observation_scores (
        id,
        dimension_id,
        level_value,
        tbos_behavioral_dimensions (id, code, name)
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
    .eq("id", id)
    .single();

  if (error || !observation) {
    return NextResponse.json({ success: false, error: "Observasi tidak ditemukan." }, { status: 404 });
  }

  // Facilitators can only see their own
  if (auth.role !== "admin" && (observation as any).profile_id !== auth.userId) {
    return NextResponse.json({ success: false, error: "Akses ditolak." }, { status: 403 });
  }

  // Fetch audit log
  const { data: auditLog } = await db
    .from("tbos_observation_audit_log")
    .select(`
      id,
      actor_id,
      actor_role,
      action,
      previous_status,
       new_status,
       changes,
       created_at
     `)
   .eq("observation_id", id)
   .order("created_at", { ascending: false });

  const profileIds = [
    (observation as any).profile_id,
    ...((auditLog || []) as any[]).map((entry) => entry.actor_id),
  ].filter((profileId): profileId is string => Boolean(profileId));
  const { data: profileRows, error: profileError } = profileIds.length > 0
    ? await db.from("profiles").select("id, full_name").in("id", [...new Set(profileIds)])
    : { data: [], error: null };

  if (profileError) {
    console.error("[T-BOS Observation Detail] profile query error:", JSON.stringify(profileError));
    return NextResponse.json({ success: false, error: profileError.message, code: profileError.code, hint: profileError.hint, detail: profileError.details }, { status: 500 });
  }

  const profilesById = new Map((profileRows || []).map((profile) => [profile.id, profile.full_name]));

  // Fetch mission dimensions with levels for edit mode
  const { data: missionDims } = await db
    .from("tbos_mission_dimensions")
    .select(`
      dimension_id,
      tbos_behavioral_dimensions (id, code, name, question, order_index)
    `)
    .eq("mission_id", (observation as any).mission_id);

  const dimensions = await Promise.all(
    (missionDims || []).map(async (md: any) => {
      const dim = md.tbos_behavioral_dimensions;
      if (!dim) return null;
      const { data: levels } = await db
        .from("tbos_dimension_levels")
        .select("level_value, level_label, description")
        .eq("dimension_id", dim.id)
        .order("level_value", { ascending: true });
      return { ...dim, levels: levels || [] };
    })
  );

  const obs = observation as any;
  const isAdmin = auth.role === "admin";
  const canEdit =
    obs.status === "submitted" &&
    (isAdmin || !obs.revision_deadline || new Date(obs.revision_deadline).getTime() > Date.now());

  return NextResponse.json({
    success: true,
    observation: {
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
      canEdit,
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
      dimensions: dimensions.filter(Boolean),
      auditLog: (auditLog || []).map((al: any) => ({
        id: al.id,
        actorId: al.actor_id,
        actorRole: al.actor_role,
         actorName: profilesById.get(al.actor_id) || "System",
        action: al.action,
        previousStatus: al.previous_status,
        newStatus: al.new_status,
        changes: al.changes,
        createdAt: al.created_at,
      })),
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const db = createServerSupabase();
  const { error } = await db.rpc("tbos_mutate_observation", {
    p_observation_id: id,
    p_actor_id: auth.userId,
    p_actor_role: auth.role === "admin" ? "admin" : "facilitator",
    p_action: parsed.data.action,
    p_notes: parsed.data.notes ?? null,
    p_scores: parsed.data.scores ?? null,
  });

  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "23503" ? 404 : error.code === "23505" || error.code === "55000" ? 409 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }

  return NextResponse.json({ success: true });
}
