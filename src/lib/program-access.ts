import type { SupabaseClient } from "@supabase/supabase-js";
import { programAccessAvailable } from "@/lib/client-program";

export type ProgramModuleKey = "tbos" | "lep" | "binainsight";

export async function isProgramAccessible(db: SupabaseClient, programId: string): Promise<boolean> {
  const { data, error } = await db
    .from("engagements")
    .select("status, end_date")
    .eq("id", programId)
    .maybeSingle();

  if (error) throw new Error(`Gagal memeriksa masa akses program: ${error.message}`);
  return Boolean(data && programAccessAvailable(data));
}

export async function isProgramModuleEnabled(
  db: SupabaseClient,
  programId: string,
  moduleKey: ProgramModuleKey,
): Promise<boolean> {
  const { data, error } = await db
    .from("program_modules")
    .select("enabled")
    .eq("program_id", programId)
    .eq("module_key", moduleKey)
    .maybeSingle();

  if (error) {
    throw new Error(`Gagal memeriksa modul program: ${error.message}`);
  }

  return data?.enabled === true;
}

export async function isParticipantInProgram(
  db: SupabaseClient,
  profileId: string,
  programId: string,
): Promise<boolean> {
  const { data: participant, error: participantError } = await db
    .from("participants")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (participantError) {
    throw new Error(`Gagal memeriksa peserta: ${participantError.message}`);
  }
  if (!participant) return false;

  const { data: membership, error: membershipError } = await db
    .from("engagement_participants")
    .select("id")
    .eq("engagement_id", programId)
    .eq("participant_id", participant.id)
    .maybeSingle();

  if (membershipError) {
    throw new Error(`Gagal memeriksa keanggotaan program: ${membershipError.message}`);
  }

  return Boolean(membership);
}

export async function getParticipantProgramIds(
  db: SupabaseClient,
  profileId: string,
): Promise<string[]> {
  const { data: participant, error: participantError } = await db
    .from("participants")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (participantError) {
    throw new Error(`Gagal memeriksa peserta: ${participantError.message}`);
  }
  if (!participant) return [];

  const { data, error } = await db
    .from("engagement_participants")
    .select("engagement_id")
    .eq("participant_id", participant.id);

  if (error) {
    throw new Error(`Gagal memuat program peserta: ${error.message}`);
  }

  return [...new Set((data || []).map((row) => row.engagement_id))];
}
