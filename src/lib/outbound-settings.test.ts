import { describe, expect, it, vi, afterEach } from "vitest";
import { DEFAULT_OUTBOUND_SETTINGS, loadOutboundSettings, outboundSettingsSchema, outboundEmergencyStopped } from "./outbound-settings";
import type { createServerSupabase } from "./supabase";
const valid = { campaignId: "11111111-1111-4111-8111-111111111111", enabled: true, recipientMode: "restricted", allowedEmails: ["ADMIN@EXAMPLE.COM"], businessHoursOnly: false, expectedVersion: 0, confirmation: "SAVE_OUTBOUND_SETTINGS" };
afterEach(() => vi.unstubAllEnvs());
describe("app-managed outbound settings", () => {
  it("defaults to paused and never uses legacy env flags", () => {
    vi.stubEnv("OUTBOUND_EMAIL_ENABLED", "true"); vi.stubEnv("AUTOMATION_PILOT_ENABLED", "true");
    expect(DEFAULT_OUTBOUND_SETTINGS.enabled).toBe(false); expect(outboundEmergencyStopped()).toBe(false);
    vi.stubEnv("OUTBOUND_EMAIL_FORCE_DISABLED", "true"); expect(outboundEmergencyStopped()).toBe(true);
  });
  it("normalizes valid emails and enforces explicit restricted scope", () => {
    expect(outboundSettingsSchema.parse(valid).allowedEmails).toEqual(["admin@example.com"]);
    expect(outboundSettingsSchema.safeParse({ ...valid, allowedEmails: [] }).success).toBe(false);
    expect(outboundSettingsSchema.safeParse({ ...valid, recipientMode: "approved_list", allowedEmails: [] }).success).toBe(true);
    expect(outboundSettingsSchema.safeParse({ ...valid, actor: "forged" }).success).toBe(false);
  });
  it("fails closed on missing migration or query errors", async () => {
    const db = (error: { code: string }) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error }) }) }) }) }) as unknown as ReturnType<typeof createServerSupabase>;
    await expect(loadOutboundSettings(db({ code: "42P01" }), valid.campaignId)).rejects.toThrow("SQL 61");
    await expect(loadOutboundSettings(db({ code: "other" }), valid.campaignId)).rejects.toThrow("Tidak ada email");
  });
});
