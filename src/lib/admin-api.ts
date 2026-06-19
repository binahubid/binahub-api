import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { z } from "zod";
import type { createServerSupabase } from "@/lib/supabase";

type AdminDb = ReturnType<typeof createServerSupabase>;

type AuditEvent = {
  eventType: string;
  targetType: string;
  targetId?: string | null;
  actor: string;
  payload?: Record<string, unknown>;
  status?: string;
  message: string;
};

export function adminError(error: string, status = 400, code?: string) {
  return NextResponse.json({ success: false, error, code }, { status });
}

export async function parseJsonBody(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { data: null, error: "Payload request harus berupa object JSON." };
    }
    return { data: body as Record<string, unknown>, error: null };
  } catch {
    return { data: null, error: "Payload JSON tidak valid." };
  }
}

export async function parseValidatedBody<T extends z.ZodType>(
  req: NextRequest,
  schema: T
): Promise<{ data: z.infer<T>; error: null } | { data: null; error: string }> {
  const body = await parseJsonBody(req);
  if (body.error || !body.data) {
    return { data: null, error: body.error || "Payload JSON tidak valid." };
  }

  const result = schema.safeParse(body.data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    return { data: null, error: firstIssue?.message || "Payload request tidak valid." };
  }

  return { data: result.data as z.infer<T>, error: null };
}

export function getIdempotencyKey(req: NextRequest) {
  const key = req.headers.get("idempotency-key") || req.headers.get("x-idempotency-key");
  return key?.trim() || null;
}

export async function logAdminEvent(db: AdminDb, event: AuditEvent) {
  try {
    await db.from("automation_events").insert({
      event_type: event.eventType,
      target_type: event.targetType,
      target_id: event.targetId || null,
      actor: event.actor,
      payload: event.payload || {},
      status: event.status || "Logged",
      message: event.message,
    });
  } catch {
    // Audit logging must never block the primary admin action.
  }
}
