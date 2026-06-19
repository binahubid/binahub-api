import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";

const PROJECT_FIELDS = [
  "client_name",
  "contact_name",
  "contact_email",
  "service",
  "program_name",
  "project_type",
  "scope",
  "budget_note",
  "start_date",
  "end_date",
  "status",
  "source_type",
  "source_id",
  "automation_mode",
] as const;

const projectStatusSchema = z.enum([
  "Draft",
  "Autopilot Drafted",
  "Autopilot Running",
  "Invitation Sent",
  "Active",
  "Completed",
  "Paused",
  "Cancelled",
  "Closed",
]);

const projectBodySchema = z.object({
  client_name: z.string().trim().min(1, "Nama klien wajib diisi."),
  program_name: z.string().trim().min(1, "Nama program wajib diisi."),
  contact_name: z.string().trim().optional().default(""),
  contact_email: z.string().trim().email("Email kontak tidak valid.").or(z.literal("")).optional().default(""),
  service: z.string().trim().optional().default(""),
  project_type: z.string().trim().optional().default("Transformation"),
  scope: z.string().trim().optional().default(""),
  budget_note: z.string().trim().optional().default(""),
  start_date: z.string().trim().optional().default(""),
  end_date: z.string().trim().optional().default(""),
  status: projectStatusSchema.optional().default("Draft"),
  source_type: z.string().trim().optional().default("manual"),
  source_id: z.string().trim().optional().default(""),
  automation_mode: z.string().trim().optional().default("autopilot"),
});

const projectStatusBodySchema = z.object({
  id: z.string().trim().min(1, "Project ID wajib diisi."),
  status: projectStatusSchema,
});

function cleanProjectPayload(body: Record<string, unknown>) {
  return Object.fromEntries(
    PROJECT_FIELDS.map((field) => {
      const value = body[field];
      return [field, typeof value === "string" ? value.trim() || null : value || null];
    })
  );
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const db = createServerSupabase();
  const [{ data: projects, error }, { data: roles }, { data: assignments }] = await Promise.all([
    db.from("projects").select("*").order("created_at", { ascending: false }).limit(100),
    db.from("project_roles").select("*").order("created_at", { ascending: false }).limit(300),
    db.from("project_assignments").select("*").order("created_at", { ascending: false }).limit(300),
  ]);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, projects: projects || [], roles: roles || [], assignments: assignments || [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, projectBodySchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_PROJECT_PAYLOAD");
  }

  const db = createServerSupabase();
  const body = parsed.data;
  const payload = {
    ...cleanProjectPayload(body),
    client_name: body.client_name,
    program_name: body.program_name,
    status: body.status,
    created_by: admin.email,
  };

  const { data, error } = await db.from("projects").insert(payload).select().single();
  if (error) {
    return adminError(error.message, 500, "PROJECT_CREATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "project_created",
    targetType: "project",
    targetId: data.id,
    actor: admin.email,
    payload: data,
    status: "Logged",
    message: `Project ${data.program_name} dibuat.`,
  });

  const { data: existingAction } = await db
    .from("smart_actions")
    .select("id")
    .eq("target_type", "project")
    .eq("target_id", data.id)
    .eq("action_type", "run_project_autopilot")
    .maybeSingle();

  if (!existingAction) {
    const { error: actionError } = await db.from("smart_actions").insert({
      action_type: "run_project_autopilot",
      title: `Jalankan Project Autopilot: ${data.program_name}`,
      description: "Generate role assignment, matching associate, dan draft ajakan kerja sama.",
      target_type: "project",
      target_id: data.id,
      priority: "High",
      status: "Pending",
      mode: data.automation_mode === "auto_send" ? "auto" : "approval_required",
    });

    if (actionError) {
      return adminError(`Project tersimpan, tetapi smart action gagal: ${actionError.message}`, 500, "SMART_ACTION_CREATE_FAILED");
    }
  }

  return NextResponse.json({ success: true, project: data });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, projectStatusBodySchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_PROJECT_STATUS_PAYLOAD");
  }

  const db = createServerSupabase();
  const { id, status } = parsed.data;
  const { data, error } = await db
    .from("projects")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "PROJECT_STATUS_UPDATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "project_status_updated",
    targetType: "project",
    targetId: id,
    actor: admin.email,
    payload: { status },
    status: "Logged",
    message: `Status project diubah menjadi ${status}.`,
  });

  return NextResponse.json({ success: true, project: data });
}
