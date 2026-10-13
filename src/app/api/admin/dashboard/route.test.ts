import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), select: vi.fn(), leadQueries: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
import { GET } from "./route";
const request = () => new NextRequest("https://api.example.com/api/admin/dashboard");
beforeEach(() => {
  vi.resetAllMocks(); mocks.leadQueries = [{ data: [], error: null, count: 0 }];
  mocks.auth.mockResolvedValue({ email: "admin@example.com" });
  mocks.db.mockReturnValue({ from: (table: string) => {
    const result = table === "leads" ? mocks.leadQueries.shift() : { data: [], error: null };
    const query = { select: (fields: string, options?: unknown) => { mocks.select(table, fields, options); return query; },
      order: () => query, limit: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    return query;
  } });
});
describe("dashboard funnel coverage", () => {
  it("authenticates before inspecting pipeline or counting records", async () => {
    mocks.auth.mockResolvedValue({ error: "Denied", status: 403 });
    expect((await GET(request())).status).toBe(403); expect(mocks.db).not.toHaveBeenCalled();
  });
  it("returns exact population and loaded count without claiming a capped response is complete", async () => {
    mocks.leadQueries = [{ data: [{ id: "lead-1", name: "Demo", opportunity_stage: "proposal", email: "demo@example.com" }], count: 2000, error: null }];
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ salesFunnelCoverage: { loaded: 1, total: 2000, stageDataAvailable: true, loadError: false }, pipelineLeads: [{ opportunityStage: "proposal" }] });
    expect(mocks.select).toHaveBeenCalledWith("leads", expect.any(String), { count: "exact" });
  });
  it("marks fallback stage data as unavailable rather than claiming all leads are Awareness", async () => {
    mocks.leadQueries = [{ data: null, error: { message: "Column unavailable" } }, { data: [{ id: "lead-1" }], count: 1, error: null }];
    expect(await (await GET(request())).json()).toMatchObject({ salesFunnelCoverage: { stageDataAvailable: false, loadError: false } });
  });
  it("signals load failure instead of a real empty population", async () => {
    mocks.leadQueries = [{ data: null, error: { message: "Failure" } }, { data: null, count: null, error: { message: "Failure" } }];
    expect(await (await GET(request())).json()).toMatchObject({ salesFunnelCoverage: { loaded: 0, total: null, loadError: true } });
  });
});
