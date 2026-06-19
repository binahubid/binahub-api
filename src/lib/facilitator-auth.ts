import { NextRequest } from "next/server";
import {
  getUserFromBearer,
  getUserRole,
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
  const role = getUserRole(auth.user);

  if (
    role !== "facilitator" &&
    role !== "admin" &&
    !isFacilitatorFallbackEmail(email) &&
    !isAdminFallbackEmail(email)
  ) {
    return { error: "Akses fasilitator tidak valid", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: role || "facilitator" };
}
