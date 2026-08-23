import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({
  supabase: { auth: { getUser: vi.fn() } },
  createServerSupabase: vi.fn(),
}));
import {
  getBearerToken,
  isAdminFallbackEmail,
  isFacilitatorFallbackEmail,
  readEmailAllowlist,
} from "./auth-role";

const originalAdminEmails = process.env.ADMIN_EMAILS;
const originalFacilitatorEmails = process.env.FACILITATOR_EMAILS;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
  else process.env.ADMIN_EMAILS = originalAdminEmails;

  if (originalFacilitatorEmails === undefined) delete process.env.FACILITATOR_EMAILS;
  else process.env.FACILITATOR_EMAILS = originalFacilitatorEmails;
});

describe("role allowlists", () => {
  it("does not grant a magic default admin or facilitator role", () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.FACILITATOR_EMAILS;

    expect(isAdminFallbackEmail("admin@binahub.id")).toBe(false);
    expect(isFacilitatorFallbackEmail("facilitator@binahub.id")).toBe(false);
  });

  it("normalizes explicitly configured allowlists", () => {
    process.env.ADMIN_EMAILS = " Admin@One.test,second@test.dev ";
    process.env.FACILITATOR_EMAILS = "Coach@One.test";

    expect(isAdminFallbackEmail("admin@one.test")).toBe(true);
    expect(isAdminFallbackEmail("second@test.dev")).toBe(true);
    expect(isFacilitatorFallbackEmail("coach@one.test")).toBe(true);
  });

  it("ignores empty allowlist entries", () => {
    expect([...readEmailAllowlist(" , ")]).toEqual([]);
  });
});

describe("bearer parsing", () => {
  it("accepts a case-insensitive bearer scheme with one token", () => {
    expect(getBearerToken("bearer valid.token-value")).toBe("valid.token-value");
  });

  it.each([null, "", "Basic abc", "Bearer", "Bearer token extra", "xBearer token"])(
    "rejects malformed authorization input: %s",
    (value) => expect(getBearerToken(value)).toBeNull(),
  );
});
