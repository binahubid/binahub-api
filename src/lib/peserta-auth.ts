import { NextRequest } from "next/server";
import { getAuthoritativeUserRole, getUserFromBearer, normalizeEmail } from "@/lib/auth-role";
import { getClientAccessBySupabaseUser } from "@/lib/client-access";

export async function requirePeserta(req: NextRequest) {
  const auth = await getUserFromBearer(req);

  if ("error" in auth) {
    return auth;
  }

  const email = normalizeEmail(auth.user.email);
  let role;
  try {
    role = await getAuthoritativeUserRole(auth.user);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Gagal memverifikasi role", status: 500 as const };
  }

  if (role !== "peserta" && role !== "client") {
    return { error: "Akses tidak valid", status: 403 as const };
  }

  if (role === "client") {
    const access = await getClientAccessBySupabaseUser(auth.user.id, auth.user.app_metadata || {});
    if (!access) return { error: "Akses peserta tidak valid atau kode telah diperbarui.", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: role as "peserta" | "client" };
}
