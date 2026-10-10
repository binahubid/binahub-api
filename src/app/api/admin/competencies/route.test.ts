import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), select: vi.fn(), results: {} as Record<string, unknown> }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
import { GET } from "./route";
const request = () => new NextRequest("https://api.example.com/api/admin/competencies");
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ email: "admin@example.com" });
  mocks.results = {
    competency_frameworks: { data: { id: "signature-2026-competency-v1" }, error: null },
    competency_dictionary: { data: [{ code: "COMP-001", name: "Adaptasi", definition: null }], error: null },
    catalog_module_competencies: { data: [], error: null },
  };
  mocks.db.mockReturnValue({ from: (table: string) => ({ select: (fields: string) => {
    mocks.select(fields);
    return { eq: () => ({ maybeSingle: async () => mocks.results[table], order: async () => mocks.results[table] }) };
  } }) });
});
describe("admin competency dictionary", () => {
  it("requires admin access before accessing privileged data", async () => {
    mocks.auth.mockResolvedValue({ error: "Denied", status: 403 });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.db).not.toHaveBeenCalled();
  });
  it("returns the dictionary without activating assessment or selecting commercial data", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ assessmentIntegrationActive: false,
      competencies: [{ definition: null }] });
    expect(mocks.select.mock.calls.flat().join(",")).not.toMatch(/base_price|metadata|email|answers/);
  });
  it.each(["42P01", "PGRST205"])("reports missing SQL instead of presenting an empty dictionary (%s)", async (code) => {
    mocks.results.competency_dictionary = { data: null, error: { code } };
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "COMPETENCY_SETUP_REQUIRED" });
  });
  it("reports a missing framework seed", async () => {
    mocks.results.competency_frameworks = { data: null, error: null };
    expect((await GET(request())).status).toBe(503);
  });
  it("does not expose database details on unexpected failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.results.catalog_module_competencies = { error: { message: "private database detail" } };
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
    log.mockRestore();
  });
});
