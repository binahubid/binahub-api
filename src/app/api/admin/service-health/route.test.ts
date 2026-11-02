import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), db: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: deps.auth }));
vi.mock("@/lib/service-health", () => ({ loadServiceHealth: deps.load }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: deps.db }));
import { GET, HEAD } from "./route";
const req = () =>
  new NextRequest("https://example.invalid/api/admin/service-health");
beforeEach(() => {
  vi.clearAllMocks();
  deps.auth.mockResolvedValue({ email: "admin@example.invalid" });
  deps.load.mockResolvedValue({ readiness: "ready", operations: "attention" });
});
describe("admin-only readiness overview/probe", () => {
  it.each([401, 403, 500])(
    "does not read operational data when admin verification fails (%i)",
    async (status) => {
      deps.auth.mockResolvedValue({ error: "PRIVATE_AUTH_DETAILS", status });
      const result = await GET(req());
      expect(result.status).toBe(status);
      expect(deps.db).not.toHaveBeenCalled();
      expect(deps.load).not.toHaveBeenCalled();
      expect(await result.text()).not.toContain("PRIVATE_AUTH_DETAILS");
      expect((await HEAD(req())).status).toBe(status);
    },
  );
  it("is uncached and distinguishes database readiness from delayed work", async () => {
    const response = await GET(req());
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
    expect(await response.json()).toEqual({
      success: true,
      health: { readiness: "ready", operations: "attention" },
    });
    expect((await HEAD(req())).status).toBe(200);
  });
  it.each(["unavailable", "setup_required"])(
    "HEAD returns 503 for %s instead of a green probe",
    async (readiness) => {
      deps.load.mockResolvedValue({ readiness, operations: "unknown" });
      expect((await HEAD(req())).status).toBe(503);
      expect((await GET(req())).status).toBe(200);
    },
  );
  it("does not expose thrown database or environment errors", async () => {
    deps.db.mockImplementationOnce(() => {
      throw new Error("PRIVATE_CONNECTION_STRING");
    });
    const response = await GET(req());
    expect(await response.json()).toEqual({
      success: true,
      health: { readiness: "unavailable", operations: "unknown" },
    });
  });
});
