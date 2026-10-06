import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), after: vi.fn(), context: vi.fn(), process: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/email-service", () => ({ sendOutreachEmail: vi.fn(), OutreachSuppressedError: class extends Error {} }));
vi.mock("@/lib/runtime-observability", () => ({ recordRuntimeError: vi.fn() }));
vi.mock("@/lib/outbound-email", async (original) => ({ ...await original<typeof import("@/lib/outbound-email")>(), loadOutboundContext: mocks.context, processOutboundQueue: mocks.process }));
import { GET, POST } from "./route";
const campaignId = "11111111-1111-4111-8111-111111111111", prospectId = "22222222-2222-4222-8222-222222222222";
const requestKey = "33333333-3333-4333-8333-333333333333";
const template = { version: "approved-v1", subject: "Halo {{company}}", html: '<p>{{name}}</p><a href="https://binahub.id/diagnosa">Diagnosa</a>' };
let hasTest: boolean, duplicate: boolean, optedOut: boolean;
const rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); hasTest = true; duplicate = false; optedOut = false;
  mocks.auth.mockResolvedValue({ email: "admin@example.com" });
  mocks.context.mockResolvedValue({ ready: true, blockers: [], template, source: { id: "source", lawful_basis: "legitimate_interest", retention_days: 365 }, audience: new Set(["admin@example.com", "target@example.com"]), control: { effectiveMode: "pilot" } });
  rpc.mockImplementation(async () => ({ data: { jobId: "job", queued: duplicate ? 0 : 1, duplicate }, error: null }));
  mocks.db.mockReturnValue({ rpc, from: (table: string) => {
    const rows = () => ({
      outbound_email_jobs: hasTest ? [{ id: "test-job", outbound_email_deliveries: [{ status: "sent", email: "admin@example.com" }] }] : [],
      acquisition_prospects: [{ id: prospectId, batch_id: "batch", source_id: "source", campaign_id: campaignId, name: "Rina", email: "target@example.com", company: "Contoh", validation_status: "valid", consent_status: optedOut ? "opted_out" : "unknown" }],
      prospect_import_batches: [{ id: "batch", status: "approved", approved_by: "admin", approved_at: new Date().toISOString(), created_at: new Date().toISOString() }],
      outbound_email_deliveries: [], email_suppressions: [],
    })[table] || [];
    const query = { select: () => query, eq: () => query, gte: () => query, order: () => query, limit: () => query, in: () => query,
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve) };
    return query;
  } });
});
const request = (override: Record<string, unknown> = {}) => new NextRequest("https://api.example.com/api/admin/acquisition/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", campaignId, locale: "id", requestKey, prospectIds: [prospectId], confirmation: "SEND_SELECTED_RECIPIENTS", ...override }) });

describe("admin initial outreach endpoint", () => {
  it("denies unauthenticated readers and writers before loading privileged data", async () => {
    mocks.auth.mockResolvedValue({ error: "Not allowed", status: 403 });
    expect((await POST(request())).status).toBe(403);
    expect((await GET(new NextRequest(`https://api.example.com/api/admin/acquisition/email?campaignId=${campaignId}`))).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("validates confirmation, unique target IDs and the 50-recipient bound on the server", async () => {
    expect((await POST(request({ confirmation: "SEND_TEST_TO_MY_EMAIL" }))).status).toBe(400);
    expect((await POST(request({ prospectIds: [prospectId, prospectId] }))).status).toBe(409);
    expect((await POST(request({ prospectIds: Array(51).fill(prospectId) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("queues quickly and sends only after the response using the durable job", async () => {
    const response = await POST(request()); expect(response.status).toBe(202);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_request_key: requestKey, p_kind: "initial", p_recipients: [{ prospectId, email: "target@example.com" }] });
    expect(mocks.process).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0](); expect(mocks.process).toHaveBeenCalledWith("job");
  });
  it("never queues a live send without the server's proof of a recent matching test", async () => {
    hasTest = false; const response = await POST(request()); expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("email uji") }); expect(rpc).not.toHaveBeenCalled();
  });
  it("queues tests only to the requesting admin and rejects client-supplied addresses", async () => {
    expect((await POST(request({ action: "test", confirmation: "SEND_TEST_TO_MY_EMAIL", prospectIds: [], email: "other@example.com" }))).status).toBe(400);
    expect((await POST(request({ action: "test", confirmation: "SEND_TEST_TO_MY_EMAIL", prospectIds: [] }))).status).toBe(202);
    expect(rpc.mock.calls[0][1].p_recipients).toEqual([{ prospectId: null, name: "Bapak/Ibu", email: "admin@example.com", company: "BinaHub" }]);
  });
  it("blocks revoked recipient permission and changed operational readiness", async () => {
    optedOut = true; expect((await POST(request())).status).toBe(409);
    mocks.context.mockResolvedValue({ ready: false, blockers: ["Pengiriman dijeda"] });
    expect((await POST(request())).status).toBe(409); expect(rpc).not.toHaveBeenCalled();
  });
  it("does not launch another worker for a repeated request with nothing newly queued", async () => {
    duplicate = true; expect((await POST(request())).status).toBe(202); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("processes existing jobs only within the selected campaign", async () => {
    expect((await POST(request({ action: "process", confirmation: "PROCESS_APPROVED_QUEUE", prospectIds: [] }))).status).toBe(202);
    expect(rpc).not.toHaveBeenCalled(); await mocks.after.mock.calls[0][0](); expect(mocks.process).toHaveBeenCalledWith(undefined, campaignId);
  });
});
