import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { getAuthoritativeUserRole, getUserFromBearer } from "@/lib/auth-role";
import { requireAdmin } from "@/lib/admin-auth";
import { isParticipantInProgram, isProgramModuleEnabled } from "@/lib/program-access";
import { z } from "zod";

const createSpeakerSchema = z.object({
  programId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export async function GET(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const programId = req.nextUrl.searchParams.get("programId");
  if (!programId || !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }

  const db = createServerSupabase();
  try {
    const role = await getAuthoritativeUserRole(auth.user);
    const enabled = await isProgramModuleEnabled(db, programId, "lep");
    if (!enabled) return NextResponse.json({ success: false, error: "Modul LEP tidak aktif." }, { status: 403 });
    if (role === "peserta" || role === "client") {
      const member = await isParticipantInProgram(db, auth.user.id, programId);
      if (!member) return NextResponse.json({ success: false, error: "Anda tidak terdaftar pada program ini." }, { status: 403 });
    } else if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Akses pemateri tidak valid." }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }
  const { data, error } = await db
    .from("lep_speakers")
    .select("id, program_id, name, sort_order")
    .eq("program_id", programId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, speakers: data || [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = createSpeakerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: "Data pemateri tidak valid." }, { status: 400 });
  const { programId, name } = parsed.data;

  const db = createServerSupabase();
  try {
    if (!(await isProgramModuleEnabled(db, programId, "lep"))) {
      return NextResponse.json({ success: false, error: "Modul LEP tidak aktif." }, { status: 409 });
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
  }

  // Determine next sort_order
  const { data: existing } = await db
    .from("lep_speakers")
    .select("sort_order")
    .eq("program_id", programId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing && existing[0]?.sort_order != null) ? existing[0].sort_order + 1 : 0;

  const { data, error } = await db
    .from("lep_speakers")
    .insert({ program_id: programId, name, sort_order: nextOrder })
    .select("id, program_id, name, sort_order")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: error.code === "23505" ? 409 : 500 });
  }

  return NextResponse.json({ success: true, speaker: data });
}
