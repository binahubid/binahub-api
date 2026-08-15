import { createHash } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase";

export const clientAccessCookie = "binahub_client_access";

export function hashAccessCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export async function getClientAccessBySupabaseUser(userId: string, appMetadata: Record<string, unknown>) {
  const accessCodeId = appMetadata.access_code_id as string;

  if (!accessCodeId) return null;

  const db = createServerSupabase();
  const { data, error } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, code_hash, expires_at, is_active, organization_id, participant_id, program_id")
    .eq("id", accessCodeId)
    .eq("auth_user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  return data;
}
