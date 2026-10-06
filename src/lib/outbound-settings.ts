import { z } from "zod";
import type { createServerSupabase } from "./supabase";

export type OutboundSettings = {
  enabled: boolean;
  recipientMode: "restricted" | "approved_list";
  allowedEmails: string[];
  businessHoursOnly: boolean;
  version: number;
};

export const DEFAULT_OUTBOUND_SETTINGS: OutboundSettings = {
  enabled: false, recipientMode: "restricted", allowedEmails: [], businessHoursOnly: false, version: 0,
};

export const outboundSettingsSchema = z.object({
  campaignId: z.string().uuid(),
  enabled: z.boolean(),
  recipientMode: z.enum(["restricted", "approved_list"]),
  allowedEmails: z.array(z.string().trim().toLowerCase().email()).max(50),
  businessHoursOnly: z.boolean(),
  expectedVersion: z.number().int().min(0),
  confirmation: z.literal("SAVE_OUTBOUND_SETTINGS"),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && value.recipientMode === "restricted" && !value.allowedEmails.length) {
    ctx.addIssue({ code: "custom", path: ["allowedEmails"], message: "Isi minimal satu alamat untuk uji terbatas." });
  }
});

export async function loadOutboundSettings(db: ReturnType<typeof createServerSupabase>, campaignId: string): Promise<OutboundSettings> {
  const result = await db.from("outbound_campaign_settings").select("enabled,recipient_mode,allowed_emails,business_hours_only,version").eq("campaign_id", campaignId).maybeSingle();
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) throw new Error("Pengaturan pengiriman belum tersedia. Tim teknis perlu menjalankan SQL 61 sekali.");
    throw new Error("Pengaturan pengiriman belum dapat dibaca. Tidak ada email yang dikirim.");
  }
  if (!result.data) return { ...DEFAULT_OUTBOUND_SETTINGS, allowedEmails: [] };
  const row = result.data;
  if (!Number.isInteger(row.version) || row.version < 1 || !["restricted", "approved_list"].includes(row.recipient_mode) || !Array.isArray(row.allowed_emails)) throw new Error("Pengaturan pengiriman tidak valid.");
  return { enabled: row.enabled === true, recipientMode: row.recipient_mode, allowedEmails: row.allowed_emails.map((email: string) => email.trim().toLowerCase()), businessHoursOnly: row.business_hours_only === true, version: row.version };
}

// Optional emergency stop only. Normal operation is controlled in the app, not env flags.
export function outboundEmergencyStopped() {
  return process.env.OUTBOUND_EMAIL_FORCE_DISABLED === "true";
}

export function outboundAudience(settings: OutboundSettings) {
  // null means approved batches + explicit send confirmation, never unrestricted arbitrary addresses.
  return settings.recipientMode === "restricted" ? new Set(settings.allowedEmails) : null;
}
