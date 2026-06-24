import type { NextRequest } from "next/server";
import { getClientAccess } from "@/lib/client-access";
import { requireAdmin } from "@/lib/admin-auth";
import { requireFacilitator } from "@/lib/facilitator-auth";

export type TransformationActor = {
  role: "admin" | "facilitator" | "client" | "worker";
  userId: string | null;
  email: string;
  organizationId?: string | null;
  participantId?: string | null;
  accessCodeId?: string | null;
};

export async function requireTransformationActor(req: NextRequest): Promise<TransformationActor | { error: string; status: number }> {
  const facilitator = await requireFacilitator(req);
  if (!("error" in facilitator)) {
    return {
      role: facilitator.role === "admin" ? "admin" : "facilitator",
      userId: facilitator.userId,
      email: facilitator.email,
    };
  }

  const clientAccess = await getClientAccess();
  if (clientAccess) {
    return {
      role: "client",
      userId: null,
      email: `client-access:${clientAccess.id}`,
      organizationId: clientAccess.organization_id || null,
      participantId: clientAccess.participant_id || null,
      accessCodeId: clientAccess.id,
    };
  }

  return { error: facilitator.error || "Akses tidak valid", status: facilitator.status || 401 };
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
