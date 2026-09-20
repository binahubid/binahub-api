import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { isProgramModuleEnabled } from "@/lib/program-access";
import { z } from "zod";
import { getFacilitatorProgramAssignment } from "@/lib/tbos-assignment";

interface MissionRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

interface DimensionRow {
  id: string;
  code: string;
  name: string;
  question: string;
  order_index: number;
}

interface MissionDimensionRow {
  tbos_behavioral_dimensions: DimensionRow | null;
}

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();
  const programId = req.nextUrl.searchParams.get("programId");
  if (programId && !z.string().uuid().safeParse(programId).success) {
    return NextResponse.json({ success: false, error: "programId tidak valid." }, { status: 400 });
  }
  let assignedMissionIds: string[] | null = null;

  if (auth.role === "facilitator") {
    if (!programId) {
      return NextResponse.json({ success: false, error: "programId wajib diisi." }, { status: 400 });
    }
    try {
      if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
        return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 403 });
      }
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
    }
    try {
      const assignment = await getFacilitatorProgramAssignment(db, auth.userId, programId);
      if (!assignment) {
        return NextResponse.json({ success: false, error: "Program di luar cakupan fasilitator." }, { status: 403 });
      }
      assignedMissionIds = assignment.selected_mission_id ? [assignment.selected_mission_id] : null;
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memuat penugasan." }, { status: 500 });
    }
  } else if (programId) {
    try {
      if (!(await isProgramModuleEnabled(db, programId, "tbos"))) {
        return NextResponse.json({ success: false, error: "Modul T-BOS tidak aktif." }, { status: 409 });
      }
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Gagal memeriksa program." }, { status: 500 });
    }
  }

  let missionQuery = db
    .from("tbos_missions")
    .select("id, code, name, description")
    .order("code", { ascending: true });
  if (assignedMissionIds) missionQuery = missionQuery.in("id", assignedMissionIds);
  const { data: missions, error: missionsError } = await missionQuery;
  if (missionsError) return NextResponse.json({ success: false, error: missionsError.message }, { status: 500 });

  const { data: programCompetencies, error: programCompetenciesError } = programId
    ? await db
        .from("tbos_program_competencies")
        .select("dimension_id,order_index,tbos_behavioral_dimensions(id,code,name,question,order_index)")
        .eq("program_id", programId)
        .order("order_index")
    : { data: null, error: null };
  if (programCompetenciesError) {
    return NextResponse.json({ success: false, error: programCompetenciesError.message }, { status: 500 });
  }
  const selectedProgramDimensions = ((programCompetencies || []) as unknown as Array<{
    tbos_behavioral_dimensions: DimensionRow | null;
  }>).map((row) => row.tbos_behavioral_dimensions).filter((dimension): dimension is DimensionRow => Boolean(dimension));

  // Get dimension mapping for each internal observation context. Program-level
  // competency selection overrides the historical mission mapping.
  const missionsWithDimensions = await Promise.all(
    ((missions || []) as MissionRow[]).map(async (mission) => {
      const { data: dims } = await db
        .from("tbos_mission_dimensions")
        .select(`
          dimension_id,
          tbos_behavioral_dimensions (
            id,
            code,
            name,
            question,
            order_index
          )
        `)
        .eq("mission_id", mission.id);

      const dimensions = (selectedProgramDimensions.length > 0 ? selectedProgramDimensions : ((dims || []) as unknown as MissionDimensionRow[])
        .map((dimension) => dimension.tbos_behavioral_dimensions)
        .filter((dimension): dimension is DimensionRow => Boolean(dimension)))
        .sort((a, b) => a.order_index - b.order_index);

      if (dimensions.length === 0) {
        throw new Error(`Konteks observasi ${mission.code} belum memiliki kompetensi.`);
      }

      // Get levels for each dimension
      const dimensionsWithLevels = await Promise.all(
        dimensions.map(async (dim) => {
          const { data: levels } = await db
            .from("tbos_dimension_levels")
            .select("level_value, level_label, description")
            .eq("dimension_id", dim.id)
            .order("level_value", { ascending: true });

          return { ...dim, levels: levels || [] };
        })
      );

      return { ...mission, dimensions: dimensionsWithLevels };
    })
  );

  return NextResponse.json({ success: true, missions: missionsWithDimensions });
}
