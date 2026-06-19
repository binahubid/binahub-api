import { NextRequest, NextResponse } from "next/server";
import { adminError, logAdminEvent, parseJsonBody } from "@/lib/admin-api";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const resources = {
  assignments: {
    table: "coach_assignments",
    fields: ["coach_id", "client_name", "program_name", "service", "status", "start_date", "end_date", "notes"],
  },
  sessions: {
    table: "coach_sessions",
    fields: ["coach_id", "assignment_id", "session_date", "duration_minutes", "topic", "rating", "evaluation", "notes"],
  },
  availability: {
    table: "coach_availability",
    fields: ["coach_id", "day_of_week", "time_window", "mode", "status", "notes"],
  },
  documents: {
    table: "coach_documents",
    fields: ["coach_id", "title", "document_type", "document_url", "status", "expiry_date", "notes"],
  },
} as const;

type ResourceKey = keyof typeof resources;

const requiredFields: Record<ResourceKey, string[]> = {
  assignments: ["coach_id", "client_name"],
  sessions: ["coach_id", "session_date"],
  availability: ["coach_id", "time_window"],
  documents: ["coach_id", "title"],
};

function getResource(req: NextRequest): ResourceKey | null {
  const resource = req.nextUrl.searchParams.get("resource") as ResourceKey | null;
  return resource && resource in resources ? resource : null;
}

function cleanPayload(resource: ResourceKey, body: Record<string, unknown>) {
  const config = resources[resource];
  return Object.fromEntries(
    config.fields.map((field) => {
      const value = body[field];
      if (field === "duration_minutes" || field === "rating") {
        const numberValue = Number(value);
        return [field, Number.isFinite(numberValue) ? numberValue : null];
      }
      return [field, typeof value === "string" ? value.trim() || null : value || null];
    })
  );
}

function validateRequiredPayload(resource: ResourceKey, payload: Record<string, unknown>) {
  const missing = requiredFields[resource].filter((field) => !payload[field]);
  return missing.length ? `Field wajib belum diisi: ${missing.join(", ")}.` : null;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const resource = getResource(req);
  if (!resource) {
    return adminError("Resource HRM tidak valid.", 400, "INVALID_HRM_RESOURCE");
  }

  const body = await parseJsonBody(req);
  if (body.error || !body.data) {
    return adminError(body.error || "Payload JSON tidak valid.", 400, "INVALID_HRM_PAYLOAD");
  }
  const payload = cleanPayload(resource, body.data);
  const validationError = validateRequiredPayload(resource, payload);
  if (validationError) {
    return adminError(validationError, 400, "HRM_REQUIRED_FIELDS_MISSING");
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from(resources[resource].table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "HRM_CREATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: `hrm_${resource}_created`,
    targetType: resource,
    targetId: data.id,
    actor: admin.email,
    payload: data,
    message: `Data ${resource} dibuat.`,
  });

  return NextResponse.json({ success: true, data });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const resource = getResource(req);
  if (!resource) {
    return adminError("Resource HRM tidak valid.", 400, "INVALID_HRM_RESOURCE");
  }

  const body = await parseJsonBody(req);
  if (body.error || !body.data) {
    return adminError(body.error || "Payload JSON tidak valid.", 400, "INVALID_HRM_PAYLOAD");
  }
  const id = String(body.data.id || "");
  if (!id) {
    return adminError("ID data HRM tidak ditemukan.", 400, "HRM_ID_REQUIRED");
  }

  const payload = cleanPayload(resource, body.data);
  const validationError = validateRequiredPayload(resource, payload);
  if (validationError) {
    return adminError(validationError, 400, "HRM_REQUIRED_FIELDS_MISSING");
  }

  const db = createServerSupabase();
  const { data, error } = await db
    .from(resources[resource].table)
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "HRM_UPDATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: `hrm_${resource}_updated`,
    targetType: resource,
    targetId: id,
    actor: admin.email,
    payload: data,
    message: `Data ${resource} diperbarui.`,
  });

  return NextResponse.json({ success: true, data });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const resource = getResource(req);
  const id = req.nextUrl.searchParams.get("id");
  if (!resource || !id) {
    return adminError("Resource atau ID tidak valid.", 400, "INVALID_HRM_DELETE_TARGET");
  }

  const db = createServerSupabase();
  const { error } = await db.from(resources[resource].table).delete().eq("id", id);
  if (error) {
    return adminError(error.message, 500, "HRM_DELETE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: `hrm_${resource}_deleted`,
    targetType: resource,
    targetId: id,
    actor: admin.email,
    message: `Data ${resource} dihapus.`,
  });

  return NextResponse.json({ success: true });
}
