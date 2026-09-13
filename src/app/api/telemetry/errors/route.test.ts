import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  rate: vi.fn(), rpc: vi.fn(), record: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: mocks.rate }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/runtime-observability", () => ({ recordRuntimeError: mocks.record }));
import { POST } from "./route";

const req = (body: unknown, origin = "https://app.binahub.id") => new NextRequest("https://api.binahub.id/api/telemetry/errors", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rate.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.record.mockResolvedValue({ stored: true, id: "event-1" });
});
describe("browser error ingestion", () => {
  it("accepts bounded reports only as untrusted frontend evidence", async () => {
    expect((await POST(req({ message: "Synthetic browser error" }))).status).toBe(202);
    expect(mocks.record).toHaveBeenCalledWith({ message: "Synthetic browser error" }, { trusted: false });
  });
  it("rejects forged trust, synthetic flags and arbitrary payload data", async () => {
    expect((await POST(req({ message: "error", trusted: true, synthetic: true, password: "secret" }))).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("rejects foreign origins", async () => {
    expect((await POST(req({ message: "error" }, "https://evil.invalid"))).status).toBe(403);
    expect(mocks.rate).not.toHaveBeenCalled();
  });
  it("honors per-client rate limiting", async () => {
    mocks.rate.mockResolvedValue(new NextResponse(null, { status: 429 }));
    expect((await POST(req({ message: "error" }))).status).toBe(429);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("honors the global ingestion budget", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(req({ message: "error" }))).status).toBe(429);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("rejects oversized bodies", async () => {
    expect((await POST(req({ message: "a".repeat(13000) }))).status).toBe(413);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("never reports a failed durable write as success", async () => {
    mocks.record.mockResolvedValue({ stored: false, id: null });
    expect((await POST(req({ message: "error" }))).status).toBe(503);
  });
});
