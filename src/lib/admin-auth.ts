import { NextRequest } from "next/server";
import { getAuthoritativeUserRole, getUserFromBearer, isAdminFallbackEmail, normalizeEmail } from "@/lib/auth-role";

export async function requireAdmin(req: NextRequest) {
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

  if (role !== "admin" && !isAdminFallbackEmail(email)) {
    return { error: "Akses admin tidak valid", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: "admin" as const };
}
