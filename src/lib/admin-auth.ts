import { NextRequest } from "next/server";
import { getUserFromBearer, getUserRole, isAdminFallbackEmail, normalizeEmail } from "@/lib/auth-role";

export async function requireAdmin(req: NextRequest) {
  const auth = await getUserFromBearer(req);

  if ("error" in auth) {
    return auth;
  }

  const email = normalizeEmail(auth.user.email);
  const role = getUserRole(auth.user);

  if (role !== "admin" && !isAdminFallbackEmail(email)) {
    return { error: "Akses admin tidak valid", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: "admin" as const };
}
