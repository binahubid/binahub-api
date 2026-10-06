import { afterEach, describe, expect, it, vi } from "vitest";
import { enrolledForSalesFollowUp, salesFollowUpSettingsSchema, salesFollowUpSetupBlockers } from "./sales-follow-up-settings";
afterEach(() => vi.unstubAllEnvs());
describe("sales follow-up controls", () => {
  it("never enrolls old or invalid-date records, including after resume", () => {
    const settings = { enabled: true, version: 2, activated_at: "2026-10-06T03:00:00Z" };
    expect(enrolledForSalesFollowUp(settings, "2026-10-05T00:00:00Z")).toBe(false);
    expect(enrolledForSalesFollowUp(settings, "2026-10-06T03:01:00Z")).toBe(true);
    expect(enrolledForSalesFollowUp(settings, "invalid")).toBe(false);
    expect(enrolledForSalesFollowUp({ ...settings, enabled: false }, "2026-10-06T03:01:00Z")).toBe(false);
  });
  it("ignores legacy master flags but checks provider setup and emergency stop", () => {
    vi.stubEnv("RESEND_API_KEY", "test-not-real"); vi.stubEnv("EMAIL_FROM", "BinaHub <test@example.com>"); vi.stubEnv("UNSUBSCRIBE_SECRET", "x".repeat(32));
    vi.stubEnv("FOLLOW_UP_DRY_RUN", "true"); vi.stubEnv("AUTOMATION_LIVE_ENABLED", "false"); vi.stubEnv("AUTOMATION_PILOT_ENABLED", "false"); vi.stubEnv("OUTBOUND_EMAIL_FORCE_DISABLED", "false");
    expect(salesFollowUpSetupBlockers()).toEqual([]);
    vi.stubEnv("OUTBOUND_EMAIL_FORCE_DISABLED", "true"); expect(salesFollowUpSetupBlockers()).toHaveLength(1);
  });
  it("requires a strict confirmed payload; never accepts a forged actor", () => {
    const body = { enabled: true, expectedVersion: 1, confirmation: "SAVE_SALES_FOLLOW_UP" };
    expect(salesFollowUpSettingsSchema.safeParse(body).success).toBe(true);
    expect(salesFollowUpSettingsSchema.safeParse({ ...body, actor: "someone@example.com" }).success).toBe(false);
    expect(salesFollowUpSettingsSchema.safeParse({ ...body, confirmation: undefined }).success).toBe(false);
  });
});
