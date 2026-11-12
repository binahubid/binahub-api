import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ admin: vi.fn(), ams: vi.fn(), rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mock.admin }));
vi.mock("@/lib/ams-client", () => ({ callAms: mock.ams }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: () => ({ rpc: mock.rpc }) }));

import { GET, POST } from "./route";

const admin = "11111111-1111-4111-8111-111111111111";
const target = "22222222-2222-4222-8222-222222222222";
const lead = "33333333-3333-4333-8333-333333333333";
const amsId = "44444444-4444-4444-8444-444444444444";
const email = "verified@example.com";
const member = { user_id: target, display_name: "Active consultant", email };
const input = { action: "assign", userId: target, leadId: lead, version: 0, note: "" };
const base = "https://api.example.com/api/admin/consultants";
const assign = (body = input) => POST(new NextRequest(base, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mock.admin.mockResolvedValue({ userId: admin });
  mock.rpc.mockImplementation(async (name) => ({
    data: name === "consultant_ams_roster" ? [member] : { success: true }, error: null,
  }));
  mock.ams.mockResolvedValue({ success: true, data: [{ id: amsId, email }] });
});

describe("Consultant assignment AMS directory", () => {
  it("only lists eligible Portal accounts and returns no email or AMS identifier", async () => {
    mock.rpc.mockResolvedValueOnce({ data: [member, { ...member, user_id: admin, email: "other@example.com" }], error: null });
    const result = await GET(new NextRequest(base + "?view=assignees"));
    expect(await result.json()).toEqual({ members: [{ id: target, name: member.display_name }] });
    expect(mock.ams).toHaveBeenCalledWith("/api/integrations/app/consultant-team/eligible", { emails: [email, "other@example.com"] });
  });

  it("verifies the submitted account again and adds proof server-side", async () => {
    expect((await assign()).status).toBe(200);
    expect(mock.rpc).toHaveBeenCalledWith("consultant_ams_roster", { p_user_id: target });
    expect(mock.rpc).toHaveBeenCalledWith("consultant_manage", {
      p_actor: admin, p_action: "assign", p_data: { ...input, verifiedAmsEmail: email, amsAssociateId: amsId },
    });
  });

  it("keeps assignments unchanged when AMS has no matching account or is unavailable", async () => {
    mock.ams.mockResolvedValueOnce({ success: true, data: [] }).mockRejectedValueOnce(new Error("Unavailable"));
    expect((await assign()).status).toBe(409);
    expect((await assign()).status).toBe(503);
    expect(mock.rpc.mock.calls.every(([name]) => name === "consultant_ams_roster")).toBe(true);
  });

  it("requires admin access before reading eligibility and rejects client-supplied verification", async () => {
    mock.admin.mockResolvedValueOnce({ error: "Forbidden", status: 403 });
    expect((await GET(new NextRequest(base + "?view=assignees"))).status).toBe(403);
    const forged = { ...input, amsAssociateId: amsId, verifiedAmsEmail: email };
    expect((await assign(forged)).status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.ams).not.toHaveBeenCalled();
  });
});
