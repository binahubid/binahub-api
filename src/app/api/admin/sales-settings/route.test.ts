import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), load: vi.fn(), blockers: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/sales-follow-up-settings", async (original) => ({ ...await original<typeof import("@/lib/sales-follow-up-settings")>(), loadSalesFollowUpSettings: mocks.load, salesFollowUpSetupBlockers: mocks.blockers }));
import { GET, PATCH } from "./route";
const request = (body: Record<string, unknown> = {}) => new NextRequest("https://api.example.com/api/admin/sales-settings", { method: "PATCH", body: JSON.stringify({ enabled: true, expectedVersion: 1, confirmation: "SAVE_SALES_FOLLOW_UP", ...body }) });
beforeEach(() => { vi.resetAllMocks(); mocks.auth.mockResolvedValue({ email: "admin@example.com" }); mocks.db.mockReturnValue({ rpc: mocks.rpc }); mocks.load.mockResolvedValue({ enabled: false, version: 1 }); mocks.blockers.mockReturnValue([]); mocks.rpc.mockResolvedValue({ data: { enabled: true, version: 2 }, error: null }); });
describe("app-managed sales settings", () => {
  it("authenticates reads and mutations before touching privileged data", async () => {
    mocks.auth.mockResolvedValue({ error: "Denied", status: 403 });
    expect((await GET(new NextRequest("https://api.example.com/api/admin/sales-settings"))).status).toBe(403);
    expect((await PATCH(request())).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("records the authenticated admin, not a browser-supplied actor", async () => {
    expect((await PATCH(request({ actor: "other@example.com" }))).status).toBe(400);
    expect((await PATCH(request())).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("save_sales_follow_up_settings", { p_enabled: true, p_expected_version: 1, p_actor: "admin@example.com" });
  });
  it("permits pausing even when sender setup is incomplete", async () => {
    mocks.blockers.mockReturnValue(["Email not ready"]);
    expect((await PATCH(request())).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await PATCH(request({ enabled: false }))).status).toBe(200);
  });
  it("returns a conflict instead of overwriting another admin's setting", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "SALES_SETTINGS_CONFLICT" } });
    expect((await PATCH(request())).status).toBe(409);
  });
});
