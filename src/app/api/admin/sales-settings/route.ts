import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { loadSalesFollowUpSettings, salesFollowUpSettingsSchema, salesFollowUpSetupBlockers } from "@/lib/sales-follow-up-settings";

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin diperlukan.", admin.status, "ADMIN_REQUIRED");
  try {
    const settings = await loadSalesFollowUpSettings(createServerSupabase());
    return NextResponse.json({ success: true, ready: Boolean(settings), settings, blockers: salesFollowUpSetupBlockers() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return adminError("Pengaturan tindak lanjut belum dapat dimuat.", 503, "SALES_SETTINGS_UNAVAILABLE"); }
}
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin diperlukan.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, salesFollowUpSettingsSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_SALES_SETTINGS");
  const input = parsed.data;
  if (input.enabled && salesFollowUpSetupBlockers().length) return adminError(salesFollowUpSetupBlockers().join(" "), 409, "SALES_EMAIL_NOT_READY");
  const result = await createServerSupabase().rpc("save_sales_follow_up_settings", { p_enabled: input.enabled, p_expected_version: input.expectedVersion, p_actor: admin.email });
  if (result.error) return adminError("Pengaturan belum tersimpan atau sudah berubah. Perbarui untuk memeriksa statusnya.", result.error.message.includes("SALES_SETTINGS_CONFLICT") ? 409 : 503, "SALES_SETTINGS_SAVE_FAILED");
  return NextResponse.json({ success: true, settings: result.data, message: input.enabled ? "Tindak lanjut otomatis aktif untuk percakapan baru setelah aktivasi ini." : "Tindak lanjut otomatis dijeda. Email yang sudah diproses tidak dapat ditarik kembali." });
}
