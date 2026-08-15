import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

const programAssignmentSchema = z.object({
  facilitatorId: z.string().uuid(),
  programId: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  const facilitatorId = req.nextUrl.searchParams.get("facilitatorId");
  if (!programId || !z.string().uuid().safeParse(programId).success
    || (facilitatorId && !z.string().uuid().safeParse(facilitatorId).success)) {
    return NextResponse.json({ success: false, error: "Parameter assignment tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }

  let query = db
    .from("facilitator_program_assignments")
    .select("profile_id, program_id, selected_mission_id, assigned_at, selected_at")
    .eq("program_id", programId);
  if (facilitatorId) query = query.eq("profile_id", facilitatorId);

  const { data: rows, error } = await query.order("assigned_at", { ascending: false });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const profileIds = [...new Set((rows || []).map((row) => row.profile_id))];
  const missionIds = [...new Set((rows || []).flatMap((row) => row.selected_mission_id ? [row.selected_mission_id] : []))];
  const [{ data: profiles }, { data: missions }] = await Promise.all([
    profileIds.length
      ? db.from("profiles").select("id, full_name").in("id", profileIds)
      : Promise.resolve({ data: [] as Array<{ id: string; full_name: string | null }> }),
    missionIds.length
      ? db.from("tbos_missions").select("id, code, name").in("id", missionIds)
      : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string }> }),
  ]);
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const missionById = new Map((missions || []).map((mission) => [mission.id, mission]));

  const assignments = (rows || []).map((row) => {
    const mission = row.selected_mission_id ? missionById.get(row.selected_mission_id) : null;
    return {
      profileId: row.profile_id,
      programId: row.program_id,
      selectedMissionId: row.selected_mission_id,
      missionId: row.selected_mission_id,
      facilitatorName: profileById.get(row.profile_id)?.full_name || "-",
      facilitatorEmail: "-",
      missionCode: mission?.code || "",
      missionName: mission?.name || "Belum memilih pos",
      assignedAt: row.assigned_at,
      selectedAt: row.selected_at,
      createdAt: row.assigned_at,
      locked: Boolean(row.selected_mission_id),
    };
  });

  return NextResponse.json({ success: true, assignments });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = programAssignmentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Fasilitator dan program wajib dipilih.", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const db = createServerSupabase();
  const { data, error } = await db.rpc("assign_facilitator_program", {
    p_facilitator_id: parsed.data.facilitatorId,
    p_program_id: parsed.data.programId,
    p_assigned_by: auth.userId,
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }

  return NextResponse.json({
    success: true,
    assignment: data,
    message: "Fasilitator ditugaskan ke program. Fasilitator akan memilih dan mengunci satu pos.",
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = programAssignmentSchema.safeParse({
    facilitatorId: req.nextUrl.searchParams.get("facilitatorId"),
    programId: req.nextUrl.searchParams.get("programId"),
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "facilitatorId dan programId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { error } = await db.rpc("remove_facilitator_program_assignment", {
    p_facilitator_id: parsed.data.facilitatorId,
    p_program_id: parsed.data.programId,
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
