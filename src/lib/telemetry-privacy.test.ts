import { describe, expect, it } from "vitest";
import { sanitizeTelemetry, safeTelemetryText } from "./telemetry-privacy";

describe("internal telemetry privacy", () => {
  it("drops unknown metadata and strips query strings, fragments and identifiers", () => {
    const input = { message: "Failure", route: "/admin?token=private#secret", password: "private", email: "private@example.com" };
    const result = sanitizeTelemetry(input);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.route).toBe("/admin");
    expect(sanitizeTelemetry({ message: "Error", route: "/client/1234567890" }).route).toBe("/client/[id]");
  });
  it("redacts common credentials, email and query-string values", () => {
    const text = safeTelemetryText("Bearer abc123 admin@example.com https://example.com/a?secret=private#secret password=private sk-abcdefghijklmnopqr");
    for (const secret of ["private", "abc123", "admin@", "abcdefghijklmnopqr"]) expect(text).not.toContain(secret);
  });
  it("bounds all stored fields", () => {
    const result = sanitizeTelemetry({ message: "a".repeat(2000), stack: "b".repeat(9000), code: "<script>" });
    expect(result.message).toHaveLength(1000);
    expect(result.stack).toHaveLength(6000);
    expect(result.code).toBe("script");
  });
});
