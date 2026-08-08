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
      profiles (full_name),
      tbos_observation_scores (
        id,
        dimension_id,
        level_value,
        tbos_behavioral_dimensions (id, code, name)
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
      created_at,
      profiles (full_name)
    `)
    .eq("observation_id", id)
    .order("created_at", { ascending: false });

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
      facilitatorName: obs.profiles?.full_name || "-",
      batch: obs.batch,
      observedAt: obs.observed_at,
      submittedAt: obs.submitted_at,
      status: obs.status,
      notes: obs.notes,
      lockedAt: obs.locked_at,
      lockedBy: obs.locked_by,
      revisionDeadline: obs.revision_deadline,
      canEdit,
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
        actorName: al.profiles?.full_name || "System",
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

  // Fetch current observation
  const { data: observation, error: fetchError } = await db
    .from("tbos_observations")
    .select("id, profile_id, status, revision_deadline, mission_id")
    .eq("id", id)
    .single();

  if (fetchError || !observation) {
    return NextResponse.json({ success: false, error: "Observasi tidak ditemukan." }, { status: 404 });
  }

  const obs = observation as any;
  const isAdmin = auth.role === "admin";
  const isOwner = obs.profile_id === auth.userId;

  // --- LOCK ---
  if (parsed.data.action === "lock") {
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: "Hanya admin yang bisa mengunci observasi." },
        { status: 403 }
      );
    }

    if (obs.status === "locked") {
      return NextResponse.json({ success: false, error: "Observasi sudah terkunci." }, { status: 409 });
    }

    const { error: updateError } = await db
      .from("tbos_observations")
      .update({
        status: "locked",
        locked_at: new Date().toISOString(),
        locked_by: auth.userId,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    await db.from("tbos_observation_audit_log").insert({
      observation_id: id,
      actor_id: auth.userId,
      actor_role: "admin",
      action: "lock",
      previous_status: obs.status,
      new_status: "locked",
    });

    return NextResponse.json({ success: true });
  }

  // --- UNLOCK ---
  if (parsed.data.action === "unlock") {
    if (!isAdmin) {
      return NextResponse.json(
        { success: false, error: "Hanya admin yang bisa membuka kunci observasi." },
        { status: 403 }
      );
    }

    if (obs.status !== "locked") {
      return NextResponse.json({ success: false, error: "Observasi tidak terkunci." }, { status: 409 });
    }

    const { error: updateError } = await db
      .from("tbos_observations")
      .update({
        status: "submitted",
        locked_at: null,
        locked_by: null,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    await db.from("tbos_observation_audit_log").insert({
      observation_id: id,
      actor_id: auth.userId,
      actor_role: "admin",
      action: "unlock",
      previous_status: "locked",
      new_status: "submitted",
    });

    return NextResponse.json({ success: true });
  }

  // --- EDIT ---
  if (parsed.data.action === "edit") {
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, error: "Anda tidak bisa mengedit observasi ini." },
        { status: 403 }
      );
    }

    if (obs.status === "locked") {
      return NextResponse.json(
        { success: false, error: "Observasi terkunci. Minta admin untuk membuka kunci." },
        { status: 409 }
      );
    }

    // Check revision window for non-admin
    if (!isAdmin && obs.revision_deadline) {
      const deadline = new Date(obs.revision_deadline).getTime();
      if (Date.now() > deadline) {
        return NextResponse.json(
          { success: false, error: "Window revisi telah berakhir. Hubungi admin." },
          { status: 403 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.notes !== undefined) {
      updateData.notes = parsed.data.notes || null;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await db
        .from("tbos_observations")
        .update(updateData)
        .eq("id", id);

      if (updateError) {
        return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
      }
    }

    // Update scores if provided
    if (parsed.data.scores && parsed.data.scores.length > 0) {
      for (const score of parsed.data.scores) {
        await db
          .from("tbos_observation_scores")
          .update({ level_value: score.levelValue })
          .eq("observation_id", id)
          .eq("dimension_id", score.dimensionId);
      }
    }

    await db.from("tbos_observation_audit_log").insert({
      observation_id: id,
      actor_id: auth.userId,
      actor_role: isAdmin ? "admin" : "facilitator",
      action: "edit",
      previous_status: obs.status,
      new_status: obs.status,
      changes: {
        notes: parsed.data.notes !== undefined ? parsed.data.notes : undefined,
        scores: parsed.data.scores ? parsed.data.scores.length : 0,
      },
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, error: "Aksi tidak dikenal." }, { status: 400 });
}
