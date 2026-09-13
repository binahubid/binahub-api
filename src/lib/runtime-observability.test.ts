import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("./supabase", () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
import { recordRuntimeError } from "./runtime-observability";
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: "event-1", error: null }); });
describe("durable runtime errors", () => {
  it("sanitizes before storage and generates a stable fingerprint", async () => {
    const input = { message: "User a@example.com failed token=private", route: "/api/a?key=secret" };
    await recordRuntimeError(input); await recordRuntimeError(input);
    const first = mocks.rpc.mock.calls[0][1];
    expect(first.p_trusted).toBe(true);
    expect(first.p_fingerprint).toHaveLength(64);
    expect(JSON.stringify(first)).not.toContain("private");
    expect(JSON.stringify(first)).not.toContain("a@example.com");
    expect(first.p_fingerprint).toBe(mocks.rpc.mock.calls[1][1].p_fingerprint);
  });
  it("keeps browser reports separate from trusted and synthetic reports", async () => {
    const input = { message: "same error" };
    await recordRuntimeError(input);
    await recordRuntimeError(input, { trusted: false });
    await recordRuntimeError(input, { synthetic: true });
    expect(new Set(mocks.rpc.mock.calls.map((c) => c[1].p_fingerprint)).size).toBe(3);
  });
  it("fails gracefully if the database is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
    expect(await recordRuntimeError({ message: "error" })).toEqual({ stored: false, id: null });
    expect(log).toHaveBeenCalledOnce(); log.mockRestore();
  });
});
