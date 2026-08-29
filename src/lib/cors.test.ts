import { describe, expect, it } from "vitest";
import { getCorsHeaders } from "./cors";

describe("CORS allow-list", () => {
  it("returns credentials only for a production origin on the allow-list", () => {
    expect(getCorsHeaders("https://app.binahub.id")).toMatchObject({
      "Access-Control-Allow-Origin": "https://app.binahub.id",
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    });
  });

  it("does not emit an allow-origin header for an untrusted origin", () => {
    const headers = getCorsHeaders("https://evil.example");

    expect(headers).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });

  it("does not treat requests without an Origin header as credentialed browser requests", () => {
    const headers = getCorsHeaders(null);

    expect(headers).not.toHaveProperty("Access-Control-Allow-Origin");
    expect(headers).not.toHaveProperty("Access-Control-Allow-Credentials");
  });

  it("allows both standard and workflow idempotency headers", () => {
    const headers = getCorsHeaders("https://binahub.id");

    expect(headers["Access-Control-Allow-Headers"]).toContain("Idempotency-Key");
    expect(headers["Access-Control-Allow-Headers"]).toContain("X-Idempotency-Key");
  });
});
