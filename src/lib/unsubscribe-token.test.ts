import { beforeEach, describe, expect, it } from "vitest";
import { createUnsubscribeToken, normalizeRecipientEmail, verifyUnsubscribeToken } from "./unsubscribe-token";

describe("unsubscribe tokens", () => {
  beforeEach(() => {
    process.env.UNSUBSCRIBE_SECRET = "test-only-unsubscribe-secret-with-entropy";
  });

  it("normalizes and recovers the bound recipient", () => {
    const token = createUnsubscribeToken("  Person@Example.COM ", 60);

    expect(normalizeRecipientEmail("  Person@Example.COM ")).toBe("person@example.com");
    expect(verifyUnsubscribeToken(token)).toBe("person@example.com");
  });

  it("rejects expired and tampered tokens", () => {
    const expired = createUnsubscribeToken("person@example.com", -1);
    const valid = createUnsubscribeToken("person@example.com", 60);

    expect(verifyUnsubscribeToken(expired)).toBeNull();
    expect(verifyUnsubscribeToken(`${valid}tampered`)).toBeNull();
  });
});
