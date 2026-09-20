import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { isProgramModuleEnabled } from "@/lib/program-access";

const programSchema = z.object({ programId: z.string().uuid() });
const updateSchema = z.object({
  programId: z.string().uuid(),
  dimensionIds: z.array(z.string().uuid()).min(1).max(8),
}).strict();

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const parsed = programSchema.safeParse({ programId: req.nextUrl.searchParams.get("programId") });
  if (!parsed.success) return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });

  const db = createServerSupabase();
  if (!(await isProgramModuleEnabled(db, parsed.data.programId, "tbos"))) {
    return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
  }

  const [dimensionsResult, configurationResult, selectedResult, observationResult] = await Promise.all([
    db.from("tbos_behavioral_dimensions").select("id,code,name,question,order_index").order("order_index"),
    db.from("tbos_program_configurations").select("competencies_locked_at,updated_at").eq("program_id", parsed.data.programId).maybeSingle(),
    db.from("tbos_program_competencies").select("dimension_id,order_index").eq("program_id", parsed.data.programId).order("order_index"),
    db.from("tbos_observations").select("id", { count: "exact", head: true }).eq("program_id", parsed.data.programId),
  ]);
  const error = dimensionsResult.error || configurationResult.error || selectedResult.error || observationResult.error;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const allDimensions = dimensionsResult.data || [];
  const selectedIds = selectedResult.data?.length
    ? selectedResult.data.map((row) => row.dimension_id)
    : allDimensions.map((dimension) => dimension.id);
  const locked = Boolean(configurationResult.data?.competencies_locked_at) || (observationResult.count || 0) > 0;

  return NextResponse.json({
    success: true,
    dimensions: allDimensions,
    selectedDimensionIds: selectedIds,
    locked,
    lockedAt: configurationResult.data?.competencies_locked_at || null,
    observationCount: observationResult.count || 0,
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data?.dimensionIds || []).size !== parsed.data?.dimensionIds.length) {
    return NextResponse.json({ success: false, error: "Pilih satu sampai delapan kompetensi tanpa duplikasi." }, { status: 400 });
  }

  const db = createServerSupabase();
  const { error } = await db.rpc("set_tbos_program_competencies", {
    p_program_id: parsed.data.programId,
    p_dimension_ids: parsed.data.dimensionIds,
    p_actor_id: auth.userId,
  });
  if (error) {
    const status = error.code === "42501" ? 409 : error.code === "22023" ? 400 : 500;
    return NextResponse.json({ success: false, error: error.message }, { status });
  }
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
