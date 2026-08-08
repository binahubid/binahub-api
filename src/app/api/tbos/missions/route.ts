import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  // Get all active missions (all facilitators can see all missions)
  // The restriction is on which TEAMS they can observe, not which missions
  const { data: missions } = await db
    .from("tbos_missions")
    .select("id, code, name, description")
    .order("code", { ascending: true });

  // Get dimension mapping for each mission
  const missionsWithDimensions = await Promise.all(
    (missions || []).map(async (mission: any) => {
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

      let dimensions = (dims || []).map((d: any) => d.tbos_behavioral_dimensions).filter(Boolean).sort((a: any, b: any) => a.order_index - b.order_index);

      // Fallback: if mission-dimensions mapping table is empty, load standard 8 dimensions
      if (dimensions.length === 0) {
        const { data: allDims } = await db
          .from("tbos_behavioral_dimensions")
          .select("id, code, name, question, order_index")
          .order("order_index", { ascending: true });

        dimensions = (allDims || []).slice(0, 4); // Standard 4 dimensions per mission
      }

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
