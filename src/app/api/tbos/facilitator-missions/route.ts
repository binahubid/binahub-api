import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";

const assignSchema = z.object({
  facilitatorId: z.string().uuid(),
  missionId: z.string().uuid(),
  programId: z.string().uuid(),
});

const bulkAssignSchema = z.object({
  facilitatorId: z.string().uuid(),
  programId: z.string().uuid(),
  missionIds: z.array(z.string().uuid()).max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Mission tidak boleh duplikat."),
});

interface AssignmentRow {
  profile_id: string;
  mission_id: string;
  program_id: string;
  created_at: string;
  profiles: { full_name: string } | null;
  tbos_missions: { code: string; name: string } | null;
}

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
    .from("facilitator_missions")
    .select(`
      profile_id,
      mission_id,
      program_id,
      created_at,
      profiles ( id, full_name ),
      tbos_missions ( id, code, name )
    `)
    .eq("program_id", programId);

  if (facilitatorId) {
    query = query.eq("profile_id", facilitatorId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const assignments = ((data || []) as unknown as AssignmentRow[]).map((row) => ({
    profileId: row.profile_id,
    missionId: row.mission_id,
    programId: row.program_id,
    facilitatorName: row.profiles?.full_name || "-",
    facilitatorEmail: "-",
    missionCode: row.tbos_missions?.code || "",
    missionName: row.tbos_missions?.name || "-",
    createdAt: row.created_at,
  }));

  return NextResponse.json({ success: true, assignments });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();

  if (Array.isArray(body.missionIds)) {
    return handleBulkAssign(body);
  }

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { facilitatorId, missionId, programId } = parsed.data;
  const db = createServerSupabase();

  if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }

  const [{ data: facilitator }, { data: mission }, { data: program }] = await Promise.all([
    db.from("profiles").select("id, role").eq("id", facilitatorId).maybeSingle(),
    db.from("tbos_missions").select("id").eq("id", missionId).maybeSingle(),
    db.from("engagements").select("id").eq("id", programId).maybeSingle(),
  ]);

  if (!facilitator || facilitator.role !== "facilitator") {
    return NextResponse.json({ success: false, error: "Akun yang dipilih bukan fasilitator." }, { status: 400 });
  }
  if (!mission) {
    return NextResponse.json({ success: false, error: "Misi tidak ditemukan." }, { status: 404 });
  }
  if (!program) {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }

  const { data, error } = await db
    .from("facilitator_missions")
    .upsert({
      profile_id: facilitatorId,
      mission_id: missionId,
      program_id: programId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, assignment: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const facilitatorId = req.nextUrl.searchParams.get("facilitatorId");
  const missionId = req.nextUrl.searchParams.get("missionId");
  const programId = req.nextUrl.searchParams.get("programId");

  const parsedParams = z.object({
    facilitatorId: z.string().uuid(),
    missionId: z.string().uuid(),
    programId: z.string().uuid(),
  }).safeParse({ facilitatorId, missionId, programId });
  if (!parsedParams.success) {
    return NextResponse.json(
      { success: false, error: "facilitatorId, missionId, dan programId wajib diisi." },
      { status: 400 }
    );
  }

  const ids = parsedParams.data;

  const db = createServerSupabase();
  if (!(await isProgramModuleEnabled(db, ids.programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }
  const { error } = await db
    .from("facilitator_missions")
    .delete()
    .eq("profile_id", ids.facilitatorId)
    .eq("mission_id", ids.missionId)
    .eq("program_id", ids.programId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

async function handleBulkAssign(body: unknown) {
  const parsed = bulkAssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Validasi gagal", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { facilitatorId, programId, missionIds } = parsed.data;
  const db = createServerSupabase();

  const { data: facilitator } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", facilitatorId)
    .maybeSingle();

  if (!facilitator || facilitator.role !== "facilitator") {
    return NextResponse.json({ success: false, error: "Akun yang dipilih bukan fasilitator." }, { status: 400 });
  }

  try {
    if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
      return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  if (missionIds.length > 0) {
    const { data: missions, error: missionError } = await db
      .from("tbos_missions")
      .select("id")
      .in("id", missionIds);
    if (missionError) return NextResponse.json({ success: false, error: missionError.message }, { status: 500 });
    if ((missions || []).length !== new Set(missionIds).size) {
      return NextResponse.json({ success: false, error: "Satu atau lebih misi tidak ditemukan." }, { status: 400 });
    }
  }

  const { data, error } = await db.rpc("replace_facilitator_missions", {
    p_facilitator_id: facilitatorId,
    p_program_id: programId,
    p_mission_ids: [...new Set(missionIds)],
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, assignments: data || [] });
}
