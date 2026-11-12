import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const processNotice = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consultant/notifications", () => ({ processConsultantNotifications: processNotice }));
import { POST } from "./route";

const secret = "synthetic-scheduler-credential";
const id = "00000000-0000-4000-8000-000000000007";
function request(authorization: string, body: unknown = { id }) {
  return new NextRequest("https://api.example.invalid/api/integrations/ams/notification-dispatch", {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("FOLLOW_UP_CRON_SECRET", secret);
  processNotice.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

it("requires the scheduler credential and a valid event ID", async () => {
  expect((await POST(request("Bearer synthetic-user-token"))).status).toBe(401);
  expect((await POST(request(secret))).status).toBe(401);
  expect((await POST(request("Bearer " + secret, {}))).status).toBe(400);
  expect(processNotice).not.toHaveBeenCalled();
});

it("passes only the requested event to the existing delivery worker", async () => {
  processNotice.mockResolvedValue({ state: "ok", accepted: 1 });
  const response = await POST(request("Bearer " + secret));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(processNotice).toHaveBeenCalledExactlyOnceWith(id);
});
