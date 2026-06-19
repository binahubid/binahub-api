import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { createServerSupabase } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

const allowedStatuses = new Set(["active", "inactive", "prospect", "archived"]);

const coachBodySchema = z.object({
  id: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nama associate wajib diisi."),
  email: z.string().trim().email("Email associate tidak valid.").or(z.literal("")).optional().default(""),
  phone: z.string().trim().optional().default(""),
  expertise: z.string().trim().optional().default(""),
  field: z.string().trim().optional().default(""),
  category: z.string().trim().optional().default(""),
  rate: z.string().trim().optional().default(""),
  availability: z.string().trim().optional().default(""),
  cvUrl: z.string().trim().optional().default(""),
  cv_url: z.string().trim().optional().default(""),
  linkedinUrl: z.string().trim().optional().default(""),
  linkedin_url: z.string().trim().optional().default(""),
  linkedinSummary: z.string().trim().optional().default(""),
  linkedin_summary: z.string().trim().optional().default(""),
  bio: z.string().trim().optional().default(""),
  notes: z.string().trim().optional().default(""),
  status: z.enum(["active", "inactive", "prospect", "archived"]).optional().default("active"),
});

function cleanCoachPayload(body: Record<string, unknown>) {
  const status = String(body.status || "active").toLowerCase();

  return {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim() || null,
    phone: String(body.phone || "").trim() || null,
    expertise: String(body.expertise || "").trim() || null,
    field: String(body.field || "").trim() || null,
    category: String(body.category || "").trim() || null,
    rate: String(body.rate || "").trim() || null,
    availability: String(body.availability || "").trim() || null,
    cv_url: String(body.cvUrl || body.cv_url || "").trim() || null,
    linkedin_url: String(body.linkedinUrl || body.linkedin_url || "").trim() || null,
    linkedin_summary: String(body.linkedinSummary || body.linkedin_summary || "").trim() || null,
    bio: String(body.bio || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
    status: allowedStatuses.has(status) ? status : "active",
  };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, coachBodySchema);
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_COACH_PAYLOAD");
  }

  const db = createServerSupabase();
  const payload = cleanCoachPayload(parsed.data);
  const { data, error } = await db
    .from("coaches")
    .insert(payload)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "COACH_CREATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "associate_created",
    targetType: "coach",
    targetId: data.id,
    actor: admin.email,
    payload: { name: data.name, email: data.email, status: data.status },
    message: `Associate ${data.name} dibuat.`,
  });

  return NextResponse.json({ success: true, coach: data });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const parsed = await parseValidatedBody(req, coachBodySchema.extend({ id: z.string().trim().min(1, "ID associate wajib diisi.") }));
  if (parsed.error || !parsed.data) {
    return adminError(parsed.error, 400, "INVALID_COACH_PAYLOAD");
  }

  const body = parsed.data;
  const id = String(body.id || "");
  if (!id) {
    return adminError("ID associate tidak ditemukan.", 400, "COACH_ID_REQUIRED");
  }

  const db = createServerSupabase();
  const payload = cleanCoachPayload(body);
  const { data, error } = await db
    .from("coaches")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return adminError(error.message, 500, "COACH_UPDATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "associate_updated",
    targetType: "coach",
    targetId: id,
    actor: admin.email,
    payload: { name: data.name, email: data.email, status: data.status },
    message: `Associate ${data.name} diperbarui.`,
  });

  return NextResponse.json({ success: true, coach: data });
}

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) {
    return NextResponse.json({ success: false, error: admin.error }, { status: admin.status });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return adminError("ID associate tidak ditemukan.", 400, "COACH_ID_REQUIRED");
  }

  const db = createServerSupabase();
  const { data: activeAssignment } = await db
    .from("coach_assignments")
    .select("id")
    .eq("coach_id", id)
    .in("status", ["Planned", "Active"])
    .limit(1)
    .maybeSingle();

  if (activeAssignment) {
    return adminError(
      "Associate masih terhubung ke assignment aktif. Arsipkan atau selesaikan assignment terlebih dahulu.",
      409,
      "COACH_HAS_ACTIVE_ASSIGNMENT"
    );
  }

  const { error } = await db.from("coaches").delete().eq("id", id);
  if (error) {
    return adminError(error.message, 500, "COACH_DELETE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "associate_deleted",
    targetType: "coach",
    targetId: id,
    actor: admin.email,
    message: `Associate ${id} dihapus.`,
  });

  return NextResponse.json({ success: true });
}
