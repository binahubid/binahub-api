import type { createServerSupabase } from "@/lib/supabase";
import type { TransformationActor } from "@/lib/transformation/auth";

type Db = ReturnType<typeof createServerSupabase>;

export async function getAccessibleProgramIds(db: Db, actor: TransformationActor): Promise<string[] | null> {
  if (actor.role === "admin" || actor.role === "worker") return null;

  if (actor.role === "facilitator") {
    if (!actor.userId) return [];
    const { data, error } = await db
      .from("facilitator_program_assignments")
      .select("program_id")
      .eq("profile_id", actor.userId);
    if (error) throw new Error(error.message);
    return [...new Set((data || []).map((row) => row.program_id))];
  }

  if (actor.participantId) {
    const { data, error } = await db
      .from("engagement_participants")
      .select("engagement_id")
      .eq("participant_id", actor.participantId);
    if (error) throw new Error(error.message);
    return [...new Set((data || []).map((row) => row.engagement_id))];
  }

  if (actor.organizationId) {
    const { data, error } = await db
      .from("engagements")
      .select("id")
      .eq("organization_id", actor.organizationId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => row.id);
  }

  return [];
}

export async function assertCanAccessEngagement(db: Db, actor: TransformationActor, engagementId: string) {
  const programIds = await getAccessibleProgramIds(db, actor);
  if (programIds !== null && !programIds.includes(engagementId)) {
    throw new Error("FORBIDDEN: Program di luar cakupan pengguna.");
  }
}

export async function assertCanAccessParticipant(
  db: Db,
  actor: TransformationActor,
  participantId: string,
  engagementId?: string,
) {
  if (actor.role === "admin" || actor.role === "worker") return;
  if (actor.role === "client" && actor.participantId !== participantId) {
    throw new Error("FORBIDDEN: Participant di luar cakupan client.");
  }

  const programIds = await getAccessibleProgramIds(db, actor);
  if (!programIds?.length) throw new Error("FORBIDDEN: Participant di luar cakupan pengguna.");

  let query = db
    .from("engagement_participants")
    .select("engagement_id")
    .eq("participant_id", participantId)
    .in("engagement_id", programIds)
    .limit(1);
  if (engagementId) query = query.eq("engagement_id", engagementId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("FORBIDDEN: Participant tidak terdaftar pada program yang dapat diakses.");
}

export function transformationErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Akses tidak valid.";
  return {
    message: message.startsWith("FORBIDDEN:") ? message.slice("FORBIDDEN:".length).trim() : message,
    status: message.startsWith("FORBIDDEN:") ? 403 : 500,
  };
}
