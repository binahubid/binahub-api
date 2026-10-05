import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ after: vi.fn(), db: vi.fn(), verify: vi.fn(), request: vi.fn(), generate: vi.fn(), observe: vi.fn(), rate: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rate }));
vi.mock("@/lib/secure-token", () => ({ verifyProposalToken: mocks.verify }));
vi.mock("@/lib/standard-proposal-request", () => ({ requestStandardProposal: mocks.request }));
vi.mock("@/lib/automatic-preliminary", () => ({ createAndSendAutomaticPreliminary: mocks.generate }));
vi.mock("@/lib/runtime-observability", () => ({ recordRuntimeError: mocks.observe }));
import { GET, POST } from "./route";

const id = "12345678-1234-4234-8234-123456789012";
const url = `https://api.example.com/api/proposal/request?assessmentId=${id}&token=signed`;
let row: Record<string, unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  row = { proposal_status: "Belum Diminta", proposal_sent_at: null, proposal_requested_at: null, form_data: { locale: "id" } };
  const query = { select: () => query, eq: () => query, single: async () => ({ data: row, error: null }) };
  mocks.db.mockReturnValue({ from: () => query });
  mocks.verify.mockReturnValue(true);
  mocks.rate.mockResolvedValue(null);
  mocks.observe.mockResolvedValue({ stored: true });
  mocks.request.mockResolvedValue({ outcome: "queued", requestedAt: "2026-10-05T00:00:00Z" });
});

describe("public proposal request route", () => {
  it("shows confirmation on GET without mutation, AI or email (including mail scanners)", async () => {
    const response = await GET(new NextRequest(url));
    expect(await response.text()).toContain("Kirim permintaan proposal");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
  it("responds before background generation and redirects to a read-only confirmation", async () => {
    const response = await POST(new NextRequest(url, { method: "POST" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe(url);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.generate).toHaveBeenCalledWith(id, "2026-10-05T00:00:00Z");
  });
  it("does not restart a request already processing or delivered", async () => {
    mocks.request.mockResolvedValue({ outcome: "processing" });
    expect((await POST(new NextRequest(url, { method: "POST" }))).status).toBe(303);
    expect(mocks.after).not.toHaveBeenCalled();
    row.proposal_sent_at = "2026-10-05T00:00:00Z";
    expect(await (await GET(new NextRequest(url))).text()).toContain("Proposal telah dikirim");
  });
  it("rejects invalid tokens before reading or writing any assessment", async () => {
    mocks.verify.mockReturnValue(false);
    expect((await POST(new NextRequest(url, { method: "POST" }))).status).toBe(400);
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("does not pretend receipt when the request was not saved", async () => {
    mocks.request.mockRejectedValue(new Error("storage down"));
    const response = await POST(new NextRequest(url, { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Permintaan belum berhasil dikirim");
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
