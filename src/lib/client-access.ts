import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase";

export const clientAccessCookie = "binahub_client_access";

export function hashAccessCode(code: string) {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export async function getClientAccess() {
  const cookieStore = await cookies();
  const token = cookieStore.get(clientAccessCookie)?.value;
  if (!token) return null;

  const db = createServerSupabase();
  const { data, error } = await db
    .from("app_client_access_codes")
    .select("id, company_name, team_name, code_hash, expires_at, is_active")
    .eq("id", token)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  return data;
}

