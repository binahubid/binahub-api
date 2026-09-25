import { createHmac, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ createServerSupabase: vi.fn() }));
import { amsIntegrationEventSchema, verifyAmsSignature } from "./ams-integration";

const originalSecret = process.env.AMS_INTEGRATION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.AMS_INTEGRATION_SECRET;
  else process.env.AMS_INTEGRATION_SECRET = originalSecret;
});

describe("AMS integration boundary", () => {
  it("accepts a fresh HMAC signature and rejects a modified body", () => {
    process.env.AMS_INTEGRATION_SECRET = "integration-secret-with-enough-entropy";
    const timestamp = String(Date.now());
    const body = JSON.stringify({ eventId: randomUUID() });
    const signature = createHmac("sha256", process.env.AMS_INTEGRATION_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    expect(verifyAmsSignature(body, timestamp, signature).ok).toBe(true);
    expect(verifyAmsSignature(`${body} `, timestamp, signature).ok).toBe(false);
  });

  it("rejects an expired signed request", () => {
    process.env.AMS_INTEGRATION_SECRET = "integration-secret-with-enough-entropy";
    const timestamp = String(Date.now() - 6 * 60_000);
    const body = "{}";
    const signature = createHmac("sha256", process.env.AMS_INTEGRATION_SECRET)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    expect(verifyAmsSignature(body, timestamp, signature)).toMatchObject({ ok: false, status: 401 });
  });

  it("requires assignment details for assignment.changed", () => {
    const parsed = amsIntegrationEventSchema.safeParse({
      eventId: randomUUID(),
      eventType: "assignment.changed",
      occurredAt: new Date().toISOString(),
      associate: {
        id: randomUUID(),
        email: "associate@example.com",
        fullName: "Associate Example",
        status: "active",
      },
    });

    expect(parsed.success).toBe(false);
  });
});
