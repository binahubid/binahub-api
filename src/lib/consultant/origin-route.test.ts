import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sources: [] as { id: string; source: string }[],
  records: [] as { id: string; company: string; canEdit: boolean }[],
  requests: [] as URL[],
  unavailable: false,
  signedIn: true,
  detail: null as null | { record: { id: string; company: string; canEdit: boolean }; workspace: null },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-role", () => ({
  getUserFromBearer: async () => state.signedIn
    ? { user: { id: "consultant-example", user_metadata: {} } }
    : { error: "Unauthorized", status: 401 },
  getAuthoritativeUserRole: async () => "consultant",
}));
vi.mock("./membership", () => ({
  assertActiveConsultantMembership: async () => undefined,
  ConsultantMembershipError: class extends Error {},
}));
// Exercise the real PostgREST client at the HTTP boundary, not a query-chain mock.
vi.mock("@/lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { createServerSupabase: () => createClient("https://fixture.invalid", "synthetic", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      state.requests.push(url);
      const detail = url.pathname.endsWith("/consultant_portal_detail");
      const data = url.pathname.endsWith("/consultant_actor") ? false
        : url.pathname.endsWith("/consultant_portal_read") ? { records: state.records, total: state.records.length }
        : detail ? state.detail || { message: "CONSULTANT_NOT_FOUND" }
        : state.unavailable ? { message: "Temporarily unavailable" } : state.sources;
      return new Response(JSON.stringify(data), {
        status: (detail && !state.detail) || (state.unavailable && url.pathname.endsWith("/leads")) ? 400 : 200,
        headers: { "Content-Type": "application/json" },
      });
    } },
  }) };
});

import { GET } from "@/app/api/konsultan/route";
import { GET as getDetail } from "@/app/api/konsultan/[id]/route";

describe("Consultant client context", () => {
  it("adds recorded channels only to authorized records without exposing source metadata or changing ownership", async () => {
    state.signedIn = true;
    state.unavailable = false;
    state.requests = [];
    state.records = [
      { id: "allowed-a", company: "Client A", canEdit: true },
      { id: "allowed-b", company: "Client B", canEdit: false },
      { id: "allowed-c", company: "Client C", canEdit: false },
    ];
    state.sources = [
      { id: "allowed-a", source: "spin_discovery" },
      { id: "allowed-b", source: "insight_assessment" },
      { id: "allowed-c", source: "constructor" },
      { id: "outside-scope", source: "contact_form" },
    ];
    const response = await GET(new NextRequest("https://fixture.invalid/api/konsultan"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.records).toEqual([
      { ...state.records[0], origin: { kind: "recommendation", label: "Rekomendasi Program", status: "recorded" } },
      { ...state.records[1], origin: { kind: "assessment_team", label: "Diagnosis Tim / Organisasi", status: "recorded" } },
      { ...state.records[2], origin: { kind: "unknown", label: "Sumber belum tercatat", status: "unrecorded" } },
    ]);
    const query = state.requests.find(url => url.pathname.endsWith("/leads"))!;
    expect(query.searchParams.get("select")).toBe("id,source");
    expect(query.searchParams.get("id")).toBe("in.(allowed-a,allowed-b,allowed-c)");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("keeps client work readable when source lookup fails and does not query data for an unsigned user", async () => {
    state.signedIn = true;
    state.unavailable = true;
    state.records = [{ id: "allowed-a", company: "Client A", canEdit: true }];
    state.requests = [];
    const response = await GET(new NextRequest("https://fixture.invalid/api/konsultan"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.records[0]).toEqual({ ...state.records[0], origin: {
      kind: "unknown", label: "Sumber belum dapat dimuat", status: "unavailable",
    } });
    state.signedIn = false;
    state.requests = [];
    const denied = await GET(new NextRequest("https://fixture.invalid/api/konsultan"));
    expect(denied.status).toBe(401);
    expect(state.requests).toHaveLength(0);
  });

  it("looks up the channel for one authorized detail and skips the lookup when the opportunity is missing", async () => {
    const id = "00000000-0000-4000-8000-000000000005";
    const req = new NextRequest("https://fixture.invalid/api/konsultan/" + id);
    const ctx = { params: Promise.resolve({ id }) };
    state.signedIn = true;
    state.unavailable = false;
    state.detail = { record: { id, company: "Client A", canEdit: false }, workspace: null };
    state.sources = [{ id, source: "contact_form" }];
    state.requests = [];
    const response = await getDetail(req, ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).record).toEqual({ ...state.detail.record, origin: {
      kind: "inquiry", label: "Inquiry / Permintaan Informasi", status: "recorded",
    } });
    expect(state.requests.find(url => url.pathname.endsWith("/leads"))?.searchParams.get("id")).toBe(`in.(${id})`);
    state.detail = null;
    state.requests = [];
    expect((await getDetail(req, ctx)).status).toBe(404);
    expect(state.requests.some(url => url.pathname.endsWith("/leads"))).toBe(false);
  });
});
