import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  record: { id: "00000000-0000-4000-8000-000000000001", assigneeId: "assigned", email: "client@example.invalid", canEdit: true, stage: "consultation" },
  authorized: true,
}));
vi.mock("@/lib/consultant/http", () => ({
  requireConsultant: () => {
    if (!fixture.authorized) throw new Error("authentication required");
    return { id: "assigned" };
  },
  consultantJson: (body: unknown) => Response.json(body),
  consultantFailure: () => Response.json({}, { status: 401 }),
}));
vi.mock("@/lib/consultant/service", () => ({
  readConsultation: () => ({ record: fixture.record, workspace: {}, proposals: [] }),
}));
vi.mock("@/lib/consultant/origin", () => ({
  withConsultantOrigins: (records: unknown[]) => records,
}));
vi.mock("@/lib/consultant/recommendation", () => ({
  readConsultantRecommendation: async () => null,
}));
import { GET } from "@/app/api/konsultan/[id]/route";

async function readDetail() {
  const id = fixture.record.id;
  return GET(new NextRequest("https://example.invalid/api/konsultan/" + id), { params: Promise.resolve({ id }) });
}

afterEach(() => {
  Object.assign(fixture.record, { canEdit: true, stage: "consultation", assigneeId: "assigned" });
  fixture.authorized = true;
  vi.unstubAllEnvs();
});

it("offers configured Cal.com booking only for open assigned work", async () => {
  vi.stubEnv("CALCOM_BOOKING_URL", "https://cal.com/binahub/konsultasi");
  expect((await (await readDetail()).json()).bookingUrl).toBe("https://cal.com/binahub/konsultasi");
  for (const record of [
    { canEdit: false, stage: "consultation", assigneeId: "assigned" },
    { canEdit: true, stage: "consultation", assigneeId: "" },
    { canEdit: true, stage: "won", assigneeId: "assigned" },
    { canEdit: true, stage: "lost", assigneeId: "assigned" },
  ]) {
    Object.assign(fixture.record, record);
    expect((await (await readDetail()).json()).bookingUrl).toBeUndefined();
  }
  fixture.authorized = false;
  expect((await readDetail()).status).toBe(401);
});

it("rejects unconfigured and non-Cal.com booking destinations", async () => {
  vi.stubEnv("NEXT_PUBLIC_CALCOM_BOOKING_URL", "");
  for (const url of ["", "https://cal.com.example.invalid/binahub/konsultasi", "https://cal.com@elsewhere.invalid/binahub/konsultasi", "http://cal.com/binahub/konsultasi"]) {
    vi.stubEnv("CALCOM_BOOKING_URL", url);
    expect((await (await readDetail()).json()).bookingUrl).toBeUndefined();
  }
});
