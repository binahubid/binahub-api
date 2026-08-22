import { NextRequest, NextResponse } from "next/server";
import { requireTransformationActor } from "@/lib/transformation/auth";
import { createServerSupabase } from "@/lib/supabase";
import { programAccessAvailable } from "@/lib/client-program";

export async function GET(req: NextRequest) {
  const actor = await requireTransformationActor(req);
  if ("error" in actor) {
    return NextResponse.json({ success: false, error: actor.error }, { status: actor.status });
  }
  if (actor.role !== "client" || !actor.programId || !actor.participantId) {
    return NextResponse.json({ success: false, error: "Sesi ini tidak terikat ke program." }, { status: 403 });
  }

  const db = createServerSupabase();
  const [{ data: program, error: programError }, { data: modules, error: moduleError }] = await Promise.all([
    db
      .from("engagements")
      .select("id, code, title, type, status, start_date, end_date, location, organization_id, organization:organizations(name)")
      .eq("id", actor.programId)
      .maybeSingle(),
    db
      .from("program_modules")
      .select("module_key, enabled")
      .eq("program_id", actor.programId)
      .eq("enabled", true)
      .order("module_key", { ascending: true }),
  ]);
  if (programError || !program) {
    return NextResponse.json({ success: false, error: "Program tidak ditemukan." }, { status: 404 });
  }
  if (moduleError) return NextResponse.json({ success: false, error: moduleError.message }, { status: 500 });
  if (!programAccessAvailable(program)) {
    return NextResponse.json({ success: false, error: "Program tidak sedang aktif." }, { status: 403 });
  }

  return NextResponse.json({
    success: true,
    program: {
      id: program.id,
      code: program.code,
      title: program.title,
      type: program.type,
      status: program.status,
      startDate: program.start_date,
      endDate: program.end_date,
      location: program.location,
      organizationId: program.organization_id,
      companyName: program.organization[0]?.name || "Perusahaan",
    },
    participant: { id: actor.participantId, name: actor.teamName || "Peserta" },
    modules: (modules || []).map((module) => ({
      key: module.module_key,
      enabled: module.enabled,
      clientAvailable: module.module_key === "lep",
    })),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}
