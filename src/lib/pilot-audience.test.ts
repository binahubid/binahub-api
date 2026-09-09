import { describe, expect, it } from "vitest";
import { assessmentRecipientEmail, canonicalEmail, isPilotRecipientAllowed } from "./pilot-audience";

describe("pilot audience", () => {
  it("canonicalizes recipient addresses before matching", () => {
    expect(canonicalEmail("  Pilot@Example.COM ")).toBe("pilot@example.com");
    expect(isPilotRecipientAllowed(new Set(["pilot@example.com"]), "PILOT@example.com")).toBe(true);
  });

  it("extracts assessment email from JSON objects or serialized form data", () => {
    expect(assessmentRecipientEmail({ email: "One@Example.com" })).toBe("one@example.com");
    expect(assessmentRecipientEmail('{"email":"Two@Example.com"}')).toBe("two@example.com");
    expect(assessmentRecipientEmail("invalid-json")).toBe("");
  });

  it("fails closed for empty and unlisted addresses", () => {
    const audience = new Set(["allowed@example.com"]);
    expect(isPilotRecipientAllowed(audience, "outside@example.com")).toBe(false);
    expect(isPilotRecipientAllowed(audience, null)).toBe(false);
  });
});
