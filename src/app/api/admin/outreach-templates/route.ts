import { NextRequest, NextResponse } from "next/server";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { outreachTemplateMutationSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

const ALLOWED_PLACEHOLDERS = new Set(["name", "company"]);

function unsupportedPlaceholders(value: string) {
  return Array.from(value.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g))
    .map((match) => match[1])
    .filter((placeholder) => !ALLOWED_PLACEHOLDERS.has(placeholder));
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const { data, error } = await createServerSupabase()
    .from("outreach_templates")
    .select("id, template_key, locale, version, status, subject_template, html_template, owner, is_mock, approved_by, approved_at, approval_note, created_by, created_at, updated_at")
    .order("template_key", { ascending: true })
    .order("locale", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) return adminError(error.message, 500, "OUTREACH_TEMPLATES_LOAD_FAILED");
  return NextResponse.json({ success: true, templates: data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, outreachTemplateMutationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_OUTREACH_TEMPLATE");
  const input = parsed.data;
  const invalid = unsupportedPlaceholders(`${input.subjectTemplate}\n${input.htmlTemplate}`);
  if (invalid.length) {
    return adminError(`Placeholder tidak didukung: ${Array.from(new Set(invalid)).join(", ")}.`, 400, "UNSUPPORTED_TEMPLATE_PLACEHOLDER");
  }

  const db = createServerSupabase();
  const { data, error } = await db.rpc("save_outreach_template", {
    p_id: input.id || null,
    p_template_key: input.templateKey,
    p_locale: input.locale,
    p_version: input.version,
    p_status: input.status,
    p_subject_template: input.subjectTemplate,
    p_html_template: input.htmlTemplate,
    p_owner: input.owner || null,
    p_is_mock: input.isMock,
    p_actor: admin.email,
    p_approval_note: input.approvalNote || null,
  });
  if (error) return adminError(error.message, error.code === "23505" ? 409 : 500, "OUTREACH_TEMPLATE_SAVE_FAILED");

  const template = Array.isArray(data) ? data[0] : data;
  await logAdminEvent(db, {
    eventType: input.status === "approved" ? "outreach_template_approved" : "outreach_template_saved",
    targetType: "outreach_template",
    targetId: template?.id || input.id || input.templateKey,
    actor: admin.email,
    payload: { templateKey: input.templateKey, locale: input.locale, version: input.version, status: input.status },
    status: "Saved",
    message: `Template ${input.templateKey} ${input.version} disimpan sebagai ${input.status}.`,
  });

  return NextResponse.json({ success: true, template });
}
