import { NextRequest } from "next/server";
import { getUserFromBearer, getUserRole, normalizeEmail } from "@/lib/auth-role";

export async function requirePeserta(req: NextRequest) {
  const auth = await getUserFromBearer(req);

  if ("error" in auth) {
    return auth;
  }

  const email = normalizeEmail(auth.user.email);
  const role = getUserRole(auth.user);

  if (role !== "peserta" && role !== "admin" && role !== "facilitator") {
    return { error: "Akses tidak valid", status: 403 as const };
  }

  return { email, userId: auth.user.id, role: role === "admin" ? ("admin" as const) : ("peserta" as const) };
}
