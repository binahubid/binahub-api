import { z } from "zod";
import type { createServerSupabase } from "./supabase";

export const salesFollowUpSettingsSchema = z.object({ enabled: z.boolean(), expectedVersion: z.number().int().min(0), confirmation: z.literal("SAVE_SALES_FOLLOW_UP") }).strict();
export type SalesFollowUpSettings = { enabled: boolean; version: number; activated_at: string | null };
export async function loadSalesFollowUpSettings(db: ReturnType<typeof createServerSupabase>): Promise<SalesFollowUpSettings | null> {
  const result = await db.from("sales_follow_up_settings").select("enabled,version,activated_at").eq("id", true).maybeSingle();
  if (result.error) {
    if (["42P01", "PGRST205"].includes(result.error.code)) return null;
    throw new Error("Kontrol tindak lanjut belum dapat dibaca.");
  }
  return result.data;
}
export function enrolledForSalesFollowUp(settings: SalesFollowUpSettings, createdAt: string | null | undefined) {
  const activation = Date.parse(settings.activated_at || ""), created = Date.parse(createdAt || "");
  return settings.enabled && Number.isFinite(activation) && Number.isFinite(created) && created >= activation;
}
export function salesFollowUpSetupBlockers() {
  const blockers: string[] = [];
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM?.includes("@") || process.env.EMAIL_FROM.includes("resend.dev")) blockers.push("Koneksi pengirim email bisnis belum siap.");
  if ((process.env.UNSUBSCRIBE_SECRET?.length || 0) < 32) blockers.push("Tautan berhenti berlangganan belum siap.");
  if (process.env.OUTBOUND_EMAIL_FORCE_DISABLED === "true") blockers.push("Pengiriman dihentikan sementara oleh tim teknis.");
  return blockers;
}
