import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ db: vi.fn(), after: vi.fn(), request: vi.fn(), process: vi.fn(), event: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...await importOriginal<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: async () => ({ email: "admin@example.com" }) }));
vi.mock("@/lib/admin-api", () => ({
  parseValidatedBody: async (req: NextRequest) => ({ data: await req.json() }),
  adminError: (error: string, status: number, code: string) => Response.json({ error, code }, { status }),
  logAdminEvent: mocks.event,
}));
vi.mock("@/lib/email-service", () => ({ sendAssessmentEmail: vi.fn(), sendProposalEmail: vi.fn() }));
vi.mock("@/lib/pdf-service", () => ({ generatePDFBuffer: vi.fn() }));
vi.mock("@/lib/standard-proposal-request", () => ({ requestStandardProposal: mocks.request }));
vi.mock("@/lib/automatic-preliminary", () => ({ createAndSendAutomaticPreliminary: mocks.process }));
vi.mock("@/lib/runtime-observability", () => ({ recordRuntimeError: vi.fn() }));
import { PATCH, POST } from "./route";

let currentStatus: string;
let updated: boolean;
let conflict: boolean;
let draft: Record<string, unknown> | null;
beforeEach(() => {
  vi.clearAllMocks();
  currentStatus = "Diminta";
  updated = false;
  conflict = false;
  draft = null;
  mocks.db.mockImplementation(() => ({ from: () => {
    const query = {
      select: () => query, eq: () => query, is: () => query,
      update: () => { updated = true; return query; },
      single: async () => ({ data: { id: "assessment-1", proposal_status: currentStatus, proposal_sent_at: null, proposal_draft_data: draft }, error: null }),
      maybeSingle: async () => ({ data: conflict ? null : { id: "assessment-1" }, error: null }),
    };
    return query;
  } }));
  mocks.request.mockResolvedValue({ outcome: "queued", requestedAt: "2026-10-05T09:00:00.000Z" });
  mocks.process.mockResolvedValue({ outcome: "sent" });
});
const request = (method: string, body: unknown) => new NextRequest("http://localhost/api/admin/assessments", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("admin standard proposal actions", () => {
  it.each(["Sedang Disusun", "Gagal Otomatis", "Perlu Rekonsiliasi"])("does not manually reset protected status %s", async (status) => {
    currentStatus = status;
    const response = await PATCH(request("PATCH", { id: "assessment-1", assessmentStatus: "Minta Proposal", proposalStatus: "Diminta" }));
    expect(response.status).toBe(409);
    expect(updated).toBe(false);
  });
  it("allows changing an unrelated assessment status without changing delivery state", async () => {
    currentStatus = "Sedang Disusun";
    expect((await PATCH(request("PATCH", { id: "assessment-1", assessmentStatus: "Follow Up", proposalStatus: currentStatus }))).status).toBe(200);
  });
  it("rejects a stale update when the background process has advanced", async () => {
    conflict = true;
    expect((await PATCH(request("PATCH", { id: "assessment-1", assessmentStatus: "Follow Up", proposalStatus: "Diminta" }))).status).toBe(409);
  });
  it("keeps legacy manual drafts distinct from active automatic processing", async () => {
    currentStatus = "Sedang Disusun";
    draft = { proposal: { subject: "Manual standard draft" } };
    expect((await PATCH(request("PATCH", { id: "assessment-1", assessmentStatus: "Minta Proposal", proposalStatus: "Disetujui" }))).status).toBe(200);
  });
  it("queues the admin action and actually creates and sends after the response", async () => {
    const response = await POST(request("POST", { id: "assessment-1", action: "request_proposal" }));
    expect(response.status).toBe(202);
    expect(mocks.request).toHaveBeenCalledWith("assessment-1", true);
    expect(mocks.process).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.process).toHaveBeenCalledWith("assessment-1", "2026-10-05T09:00:00.000Z");
  });
});
