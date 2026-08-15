import { NextRequest } from "next/server";
import {
  getUserFromBearer,
  getAuthoritativeUserRole,
  isAdminFallbackEmail,
  isFacilitatorFallbackEmail,
  normalizeEmail,
} from "@/lib/auth-role";

export async function requireFacilitator(req: NextRequest) {
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
  const isAdmin = role === "admin" || isAdminFallbackEmail(email);
  const isFacilitator = role === "facilitator" || isFacilitatorFallbackEmail(email);

  if (!isAdmin && !isFacilitator) {
    return { error: "Akses fasilitator tidak valid", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: isAdmin ? "admin" as const : "facilitator" as const };
}
