import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ db: vi.fn(), verify: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("@/lib/outbound-campaign-links", () => ({ verifyOutboundCampaignToken: mocks.verify, outboundCampaignTokenDigest: () => "digest", publicWebsiteOrigin: () => "https://binahub.id" }));
import { GET } from "./route";
let destination: string, isTest: boolean, journeyError: boolean;
const events: Array<Record<string, unknown>> = [];
const rpc = vi.fn();
beforeEach(() => {
  vi.resetAllMocks(); destination = "/insight"; isTest = false; journeyError = false; events.length = 0;
  mocks.verify.mockReturnValue(true);
  rpc.mockImplementation(async () => ({ data: journeyError ? null : "opaque-journey", error: journeyError ? { message: "Unavailable" } : null }));
  mocks.db.mockReturnValue({ rpc, from: (table: string) => {
    const data = () => ({
      outbound_campaign_links: { id: "link", source_id: "source", campaign_id: "campaign", status: "active", is_test: isTest, expires_at: new Date(Date.now() + 86_400_000).toISOString(), destination_path: destination },
      acquisition_campaigns: { campaign_code: "OCT", status: "approved", utm_config: { source: "internal_demo", medium: "email", campaign: "october" } },
      acquisition_sources: { source_key: "manual", status: "approved", active: true },
    })[table] || null;
    const query = { select: () => query, eq: () => query,
      insert: (value: Record<string, unknown>) => { events.push(value); return query; }, upsert: () => query,
      maybeSingle: async () => ({ data: data(), error: null }), then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: data(), error: null }).then(resolve) };
    return query;
  } });
});
const click = () => GET(new NextRequest("https://api.binahub.id/api/acquisition/c/token"), { params: Promise.resolve({ token: "token" }) });
describe("outbound tracked diagnostic links", () => {
  it.each(["/insight", "/en/insight"])("redirects to the existing diagnostic landing %s with journey and UTM", async (path) => {
    destination = path; const response = await click(); expect(response.status).toBe(302);
    const url = new URL(response.headers.get("location")!);
    expect(url.origin).toBe("https://binahub.id"); expect(url.pathname).toBe(path);
    expect(url.searchParams.get("bh_journey")).toBe("opaque-journey"); expect(url.searchParams.get("utm_source")).toBe("internal_demo");
    expect(rpc.mock.calls[0][1].p_route_path).toBe(path);
    expect(events[0].event_type).toBe("outbound_email_link_clicked");
  });
  it("keeps internal test attribution distinct from real initial outreach", async () => {
    isTest = true; await click(); expect(events[0].event_type).toBe("outbound_test_link_clicked");
  });
  it("preserves the root landing for legacy UAT links and never allows an open redirect", async () => {
    destination = "https://attacker.example"; const response = await click();
    expect(new URL(response.headers.get("location")!).pathname).toBe("/");
  });
  it("does not redirect if tracking cannot be durably recorded", async () => {
    journeyError = true; expect((await click()).status).toBe(503); expect(events).toHaveLength(0);
  });
  it("rejects tampered tokens before reading database data", async () => {
    mocks.verify.mockReturnValue(false); expect((await click()).status).toBe(404); expect(mocks.db).not.toHaveBeenCalled();
  });
});
