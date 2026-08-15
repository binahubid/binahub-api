import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { createServerSupabase } from "@/lib/supabase";
import { getFacilitatorProgramAssignment } from "@/lib/tbos-assignment";

const programSchema = z.object({ programId: z.string().uuid() });
const selectionSchema = programSchema.extend({ missionId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  if (auth.role !== "facilitator") {
    return NextResponse.json({ success: false, error: "Pilihan pos hanya berlaku untuk fasilitator." }, { status: 403 });
  }

  const parsed = programSchema.safeParse({ programId: req.nextUrl.searchParams.get("programId") });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }

  try {
    const db = createServerSupabase();
    const assignment = await getFacilitatorProgramAssignment(db, auth.userId, parsed.data.programId);
    if (!assignment) {
      return NextResponse.json({ success: false, error: "Anda belum ditugaskan ke program ini." }, { status: 403 });
    }
    return NextResponse.json({
      success: true,
      assignment: {
        programId: assignment.program_id,
        selectedMissionId: assignment.selected_mission_id,
        assignedAt: assignment.assigned_at,
        selectedAt: assignment.selected_at,
        locked: Boolean(assignment.selected_mission_id),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memuat pilihan pos." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }
  if (auth.role !== "facilitator") {
    return NextResponse.json({ success: false, error: "Hanya fasilitator yang dapat memilih pos." }, { status: 403 });
  }

  const parsed = selectionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Program dan misi wajib dipilih." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { data, error } = await db.rpc("select_facilitator_program_mission", {
    p_facilitator_id: auth.userId,
    p_program_id: parsed.data.programId,
    p_mission_id: parsed.data.missionId,
  });
  if (error) {
    const status = error.code === "42501" || error.code === "23505" ? 409 : error.code === "23503" ? 404 : 500;
    const message = error.code === "23505"
      ? "Pos ini sudah dipilih fasilitator lain. Pilih pos yang masih kosong."
      : error.message;
    return NextResponse.json({ success: false, error: message }, { status });
  }

  return NextResponse.json({
    success: true,
    assignment: data,
    message: "Pos berhasil dipilih dan dikunci sampai program selesai.",
  });
}
