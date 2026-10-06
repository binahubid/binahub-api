import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ db: vi.fn(), settings: vi.fn(), legacy: vi.fn(), claimRun: vi.fn(), finishRun: vi.fn(), rpc: vi.fn(), sender: vi.fn(), template: vi.fn(), blockers: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/automation-runtime-control", () => ({ loadAutomationRuntimeControl: mocks.legacy }));
vi.mock("@/lib/automation-run", () => ({ claimAutomationRun: mocks.claimRun, finishAutomationRun: mocks.finishRun }));
vi.mock("@/lib/sales-follow-up-settings", async (original) => ({ ...await original<typeof import("@/lib/sales-follow-up-settings")>(), loadSalesFollowUpSettings: mocks.settings, salesFollowUpSetupBlockers: mocks.blockers }));
vi.mock("@/lib/email-service", () => ({ sendOutreachEmail: mocks.sender, OutreachSuppressedError: class extends Error {} }));
vi.mock("@/lib/ai-service", () => ({ generateAssessmentFollowUp: vi.fn(), generateInquiryFollowUp: vi.fn() }));
vi.mock("@/lib/outreach-template", () => ({ loadApprovedOutreachTemplate: mocks.template, isOutboundAutomationActive: vi.fn(), ApprovedOutreachTemplateRequiredError: class extends Error {} }));
import { GET } from "./route";
const request = () => new NextRequest("https://api.example.com/api/admin/follow-up", { headers: { authorization: "Bearer test-cron-secret" } });
let pauseBeforeSend = false;
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-06T03:00:00Z")); pauseBeforeSend = false;
  vi.stubEnv("FOLLOW_UP_CRON_SECRET", "test-cron-secret"); vi.stubEnv("FOLLOW_UP_DRY_RUN", "true"); vi.stubEnv("AUTOMATION_PILOT_ENABLED", "false"); vi.stubEnv("AUTOMATION_LIVE_ENABLED", "false");
  mocks.settings.mockImplementation(async () => ({ enabled: !pauseBeforeSend, version: 2, activated_at: "2026-10-01T00:00:00Z" })); mocks.blockers.mockReturnValue([]);
  mocks.claimRun.mockResolvedValue({ claimed: true, runId: "run" }); mocks.finishRun.mockResolvedValue({});
  mocks.sender.mockResolvedValue({ data: { id: "email-proof" } });
  mocks.template.mockImplementation(async () => { return { subject: "Follow-up", html: "Hello", version: "v1" }; });
  mocks.rpc.mockResolvedValue({ error: null });
  mocks.db.mockReturnValue({ rpc: mocks.rpc, from: (table: string) => {
    const record = { id: "new", email: "internal@example.com", name: "Internal", status: "Baru", follow_up_level: 0, reply_sent_at: "2026-10-01T01:00:00Z", created_at: "2026-10-01T00:30:00Z" };
    const query = { select: () => query, eq: () => query, in: () => query, gte: () => query, order: () => query, limit: () => query, update: () => query, insert: () => query, maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "inquiries" ? [{ ...record, id: "old", created_at: "2026-09-01T00:00:00Z" }, record] : [], error: null, count: 0 }).then(resolve) };
    return query;
  } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("sales-controlled follow-up scheduler", () => {
  it("uses the app switch, ignores legacy flags, and excludes old conversations", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "claim_follow_up_delivery")).toHaveLength(1);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_follow_up_delivery", expect.objectContaining({ p_target_id: "new" }));
    expect(mocks.sender).toHaveBeenCalledOnce();
  });
  it("sends nothing when paused in the app", async () => {
    pauseBeforeSend = true;
    expect((await GET(request())).status).toBe(423);
    expect(mocks.sender).not.toHaveBeenCalled(); expect(mocks.claimRun).not.toHaveBeenCalled();
  });
  it("rechecks a pause after preparing the approved email and before sending", async () => {
    mocks.template.mockImplementation(async () => { pauseBeforeSend = true; return { subject: "Follow-up", html: "Hello", version: "v1" }; });
    await GET(request()); expect(mocks.sender).not.toHaveBeenCalled();
  });
});
