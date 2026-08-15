import type { NextRequest } from "next/server";
import { getClientAccessBySupabaseUser } from "@/lib/client-access";
import { requireAdmin } from "@/lib/admin-auth";
import { getAuthoritativeUserRole, getUserFromBearer, isAdminFallbackEmail, isFacilitatorFallbackEmail, normalizeEmail } from "@/lib/auth-role";

export type TransformationActor = {
  role: "admin" | "facilitator" | "client" | "worker";
  userId: string | null;
  email: string;
  organizationId?: string | null;
  participantId?: string | null;
  accessCodeId?: string | null;
  companyName?: string | null;
  teamName?: string | null;
  programId?: string | null;
};

export async function requireTransformationActor(req: NextRequest): Promise<TransformationActor | { error: string; status: number }> {
  const bearer = await getUserFromBearer(req);
  if (!("error" in bearer)) {
    try {
      const role = await getAuthoritativeUserRole(bearer.user);
      const email = normalizeEmail(bearer.user.email);
      const staffRole = role === "admin" || isAdminFallbackEmail(email)
        ? "admin"
        : role === "facilitator" || isFacilitatorFallbackEmail(email)
          ? "facilitator"
          : null;
      if (staffRole) {
        return {
          role: staffRole,
          userId: bearer.user.id,
          email,
        };
      }
      if (role === "client") {
        const access = await getClientAccessBySupabaseUser(bearer.user.id, bearer.user.app_metadata || {});
        if (!access) return { error: "Akses client tidak valid", status: 403 };
        return {
          role: "client",
          userId: bearer.user.id,
          email: normalizeEmail(bearer.user.email),
          organizationId: access.organization_id || null,
          participantId: access.participant_id || null,
          accessCodeId: access.id,
          companyName: access.company_name || null,
          teamName: access.team_name || null,
          programId: access.program_id || null,
        };
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Gagal memverifikasi akses", status: 500 };
    }
  }

  return { error: "Akses tidak valid", status: "error" in bearer ? bearer.status : 403 };
}

export async function requireTransformationAdmin(req: NextRequest): Promise<TransformationActor | { error: string; status: number }> {
  const admin = await requireAdmin(req);
  if ("error" in admin) return admin;
  return { role: "admin", userId: admin.userId, email: admin.email };
}

export function requireWorker(req: NextRequest): TransformationActor | { error: string; status: number } {
  const secret = process.env.TRANSFORMATION_WORKER_SECRET;
  if (!secret) {
    return { error: "TRANSFORMATION_WORKER_SECRET belum dikonfigurasi.", status: 500 };
  }

  const header = req.headers.get("x-worker-secret");
  if (header !== secret) {
    return { error: "Worker secret tidak valid.", status: 401 };
  }

  return { role: "worker", userId: null, email: "worker@binahub.system" };
}
