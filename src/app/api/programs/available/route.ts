import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthoritativeUserRole, getUserFromBearer } from "@/lib/auth-role";
import { createServerSupabase } from "@/lib/supabase";
import { getParticipantProgramIds, type ProgramModuleKey } from "@/lib/program-access";
import { getClientAccessBySupabaseUser } from "@/lib/client-access";

const querySchema = z.object({
  moduleKey: z.enum(["tbos", "lep"]),
});

export async function GET(req: NextRequest) {
  const auth = await getUserFromBearer(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const parsed = querySchema.safeParse({
    moduleKey: req.nextUrl.searchParams.get("moduleKey"),
  });
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "moduleKey wajib berupa tbos atau lep." }, { status: 400 });
  }

  const db = createServerSupabase();
  let allowedProgramIds: string[] | null = null;

  try {
    const role = await getAuthoritativeUserRole(auth.user);
    if (role === "peserta") {
      allowedProgramIds = await getParticipantProgramIds(db, auth.user.id);
    } else if (role === "client") {
      const access = await getClientAccessBySupabaseUser(auth.user.id, auth.user.app_metadata || {});
      allowedProgramIds = access?.program_id ? [access.program_id] : [];
    } else if (role === "facilitator") {
      const { data, error } = await db
        .from("facilitator_program_assignments")
        .select("program_id")
        .eq("profile_id", auth.user.id);
      if (error) throw new Error(error.message);
      allowedProgramIds = [...new Set((data || []).map((row) => row.program_id))];
    } else if (role !== "admin") {
      return NextResponse.json({ success: false, error: "Akses program tidak valid." }, { status: 403 });
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memuat akses program." },
      { status: 500 },
    );
  }

  if (allowedProgramIds?.length === 0) {
    return NextResponse.json({ success: true, programs: [] });
  }

  let moduleQuery = db
    .from("program_modules")
    .select("program_id")
    .eq("module_key", parsed.data.moduleKey satisfies ProgramModuleKey)
    .eq("enabled", true);
  if (allowedProgramIds) moduleQuery = moduleQuery.in("program_id", allowedProgramIds);

  const { data: moduleRows, error: moduleError } = await moduleQuery;
  if (moduleError) {
    return NextResponse.json({ success: false, error: moduleError.message }, { status: 500 });
  }

  const enabledProgramIds = [...new Set((moduleRows || []).map((row) => row.program_id))];
  if (enabledProgramIds.length === 0) {
    return NextResponse.json({ success: true, programs: [] });
  }

  const { data, error } = await db
    .from("engagements")
    .select("id, code, title, status, organization_id, start_date, end_date")
    .in("id", enabledProgramIds)
    .in("status", ["active", "in_progress", "review"])
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, programs: data || [] });
}
