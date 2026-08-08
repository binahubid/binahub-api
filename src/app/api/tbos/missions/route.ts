import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase";
import { requireFacilitator } from "@/lib/facilitator-auth";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  const auth = await requireFacilitator(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const db = createServerSupabase();

  // Get missions assigned to this facilitator
  const { data: facilitatorMissions } = await db
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

  let missions = (facilitatorMissions || []).map((fm: any) => fm.tbos_missions).filter(Boolean);

  // If no explicit assignment yet or if user is admin, fetch all active missions
  if (missions.length === 0 || auth.role === "admin") {
    const { data: allMissions } = await db
      .from("tbos_missions")
      .select("id, code, name, description")
      .order("code", { ascending: true });

    if (allMissions && allMissions.length > 0) {
      missions = allMissions;
    }
  }

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

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ("error" in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json();
  const { facilitatorId, missionId } = body;
  if (!facilitatorId || !missionId) {
    return NextResponse.json({ success: false, error: "facilitatorId dan missionId wajib diisi." }, { status: 400 });
  }

  const db = createServerSupabase();

  const { data, error } = await db
    .from("tbos_facilitator_missions")
    .upsert({
      profile_id: facilitatorId,
      mission_id: missionId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, assignment: data });
}
