import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { clientStakeholderSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, clientStakeholderSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_STAKEHOLDER");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("save_client_stakeholder", {
    p_id: input.id || null,
    p_client_account_id: input.clientAccountId,
    p_actor: admin.email,
    p_name: input.name,
    p_email: input.email || null,
    p_phone: input.phone || null,
    p_role_title: input.roleTitle || null,
    p_department: input.department || null,
    p_relationship_role: input.relationshipRole,
    p_is_primary: input.isPrimary,
    p_active: input.active,
    p_notes: input.notes || null,
  });

  if (error) {
    if (error.message.includes("CLIENT_ACCOUNT_NOT_FOUND")) return adminError("Client account tidak ditemukan.", 404, "CLIENT_ACCOUNT_NOT_FOUND");
    if (error.message.includes("STAKEHOLDER_NOT_FOUND")) return adminError("Stakeholder tidak ditemukan.", 404, "STAKEHOLDER_NOT_FOUND");
    if (error.message.includes("PRIMARY_STAKEHOLDER_MUST_BE_ACTIVE")) return adminError("Stakeholder utama harus aktif.", 400, "PRIMARY_STAKEHOLDER_MUST_BE_ACTIVE");
    if (/client_stakeholders_account_email_unique/i.test(error.message)) return adminError("Email stakeholder sudah tercatat pada client ini.", 409, "STAKEHOLDER_EMAIL_EXISTS");
    return adminError(error.message, 500, "STAKEHOLDER_SAVE_FAILED");
  }
  return NextResponse.json({ success: true, stakeholder: data });
}
