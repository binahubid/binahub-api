import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  // Get missions assigned to this facilitator
  const { data: facilitatorMissions, error: fmError } = await db
    .from("tbos_facilitator_missions")
    .select(`
      mission_id,
      tbos_missions (
        id,
        code,
        name,
        description
      )
    `)
    .eq("profile_id", auth.userId);

  if (fmError) {
    return NextResponse.json({ success: false, error: fmError.message }, { status: 500 });
  }

  const missions = (facilitatorMissions || []).map((fm: any) => fm.tbos_missions).filter(Boolean);

  // Get dimension mapping for each mission
  const missionsWithDimensions = await Promise.all(
    missions.map(async (mission: any) => {
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

      const dimensions = (dims || []).map((d: any) => d.tbos_behavioral_dimensions).filter(Boolean).sort((a: any, b: any) => a.order_index - b.order_index);

      // Get levels for each dimension
      const dimensionsWithLevels = await Promise.all(
        dimensions.map(async (dim: any) => {
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
