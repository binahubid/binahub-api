import { createServerSupabase } from "@/lib/supabase";

type Db = ReturnType<typeof createServerSupabase>;

export interface FacilitatorProgramAssignment {
  profile_id: string;
  program_id: string;
  selected_mission_id: string | null;
  assigned_at: string;
  selected_at: string | null;
  updated_at: string;
}

export async function getFacilitatorProgramAssignment(
  db: Db,
  profileId: string,
  programId: string,
) {
  const { data, error } = await db
    .from("facilitator_program_assignments")
    .select("profile_id, program_id, selected_mission_id, assigned_at, selected_at, updated_at")
    .eq("profile_id", profileId)
    .eq("program_id", programId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as FacilitatorProgramAssignment | null;
}

export async function getSelectedFacilitatorMission(
  db: Db,
  profileId: string,
  programId: string,
) {
  const assignment = await getFacilitatorProgramAssignment(db, profileId, programId);
  return assignment?.selected_mission_id || null;
}
