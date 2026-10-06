import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), control: vi.fn(), send: vi.fn(), template: vi.fn(), activation: vi.fn() }));
vi.mock("./supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("./automation-runtime-control", () => ({ loadAutomationRuntimeControl: mocks.control }));
vi.mock("./email-service", () => ({ sendOutreachEmail: mocks.send, OutreachSuppressedError: class extends Error {} }));
vi.mock("./outreach-template", () => ({ loadApprovedOutreachTemplate: mocks.template, isOutboundAutomationActive: mocks.activation }));
import { OutreachSuppressedError } from "./email-service";
import { outboundTemplateHash, processOutboundQueue, recipientBlocker, renderInitialOutreach, type OutboundProspect } from "./outbound-email";
const template = { version: "ceo-v1", subject: "Halo {{company}}", html: '<p>Yth {{name}}</p><a href="https://binahub.id/diagnosa">Diagnosa</a><a href="https://binahub.id">Website</a>' };
const source = { id: "source", lawful_basis: "legitimate_interest", retention_days: 365 };
const prospect: OutboundProspect = { id: "one", source_id: "source", campaign_id: "campaign", batch_id: "batch", name: "Rina", email: "rina@example.com", company: "Contoh", consent_status: "unknown", validation_status: "valid" };
const batch = { status: "approved", approved_by: "admin@example.com", approved_at: "2026-10-06T00:00:00Z", created_at: new Date().toISOString() };
beforeEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("initial outreach safety and rendering", () => {
  it("personalizes approved copy safely and replaces only the diagnostic CTA", () => {
    const result = renderInitialOutreach(template, { name: '<img src=x onerror="alert(1)">', company: "A\r\nB" }, "https://api.binahub.id/api/acquisition/c/token");
    expect(result.subject).toBe("Halo A  B");
    expect(result.html).toContain("&lt;img");
    expect(result.html).toContain('href="https://api.binahub.id/api/acquisition/c/token"');
    expect(result.html).toContain('href="https://binahub.id"');
  });
  it("requires a tracked CTA, HTTPS and resolved template variables", () => {
    expect(() => renderInitialOutreach({ ...template, html: "Zonder CTA" }, prospect, "https://api.binahub.id/x")).toThrow("tautan diagnosa");
    expect(() => renderInitialOutreach(template, prospect, "javascript:alert(1)")).toThrow("HTTPS");
    expect(() => renderInitialOutreach({ ...template, html: template.html + "{{unknown}}" }, prospect, "https://api.binahub.id/x")).toThrow("variabel");
  });
  it("invalidates test approval when copy or version changes", () => {
    expect(outboundTemplateHash(template)).not.toBe(outboundTemplateHash({ ...template, html: template.html + "Berubah" }));
    expect(outboundTemplateHash(template)).not.toBe(outboundTemplateHash({ ...template, version: "v2" }));
  });
  it("checks source, campaign, consent, suppression, retention, review and recipient allowlist", () => {
    const audience = new Set([prospect.email]);
    const check = (target = prospect, origin = source, review = batch, allowed = audience, suppressed = new Set<string>()) => recipientBlocker(target, origin, "campaign", review, allowed, suppressed);
    expect(check()).toBeNull();
    expect(check({ ...prospect, source_id: "different" })).toContain("tidak sesuai");
    expect(check({ ...prospect, campaign_id: "different" })).toContain("tidak sesuai");
    expect(check({ ...prospect, validation_status: "duplicate" })).toContain("validasi");
    expect(check({ ...prospect, consent_status: "opted_out" })).toContain("Tidak boleh");
    expect(check(prospect, { ...source, lawful_basis: "consent" })).toContain("Persetujuan penerima");
    expect(check(prospect, source, { ...batch, status: "staged" })).toContain("belum disetujui");
    expect(check(prospect, source, { ...batch, created_at: "2020-01-01" })).toContain("berakhir");
    expect(check(prospect, source, batch, new Set())).toContain("diizinkan");
    expect(check(prospect, source, batch, audience, new Set([prospect.email]))).toContain("Tidak boleh");
  });
  it("never claims or sends queued emails in dry-run or when disabled", async () => {
    vi.stubEnv("FOLLOW_UP_ENFORCE_BUSINESS_WINDOW", "false"); vi.stubEnv("OUTBOUND_EMAIL_ENABLED", "true");
    mocks.control.mockResolvedValue({ effectiveMode: "dry_run", activationEligible: false });
    const rpc = vi.fn(); mocks.db.mockReturnValue({ rpc });
    expect(await processOutboundQueue()).toMatchObject({ processed: 0, deferred: true });
    expect(rpc).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
});

function workerFixture(options: { templateChanged?: boolean; optedOut?: boolean; saveFailed?: boolean } = {}) {
  for (const [key, value] of Object.entries({ FOLLOW_UP_ENFORCE_BUSINESS_WINDOW: "false", OUTBOUND_EMAIL_ENABLED: "true", RESEND_API_KEY: "test-not-a-real-key", EMAIL_FROM: "outreach@example.com", UNSUBSCRIBE_SECRET: "test".repeat(10), ACQUISITION_LINK_SECRET: "test".repeat(10), NEXT_PUBLIC_BINAHUB_API_URL: "https://api.example.com" })) vi.stubEnv(key, value);
  mocks.control.mockResolvedValue({ effectiveMode: "pilot", activationEligible: true, maximumItemsPerRun: 1, pilotReleaseId: "release" });
  mocks.activation.mockResolvedValue({ active: true });
  mocks.template.mockResolvedValue({ ...template, owner: "owner", ...(options.templateChanged ? { version: "v2" } : {}) });
  mocks.send.mockResolvedValue({ data: { id: "provider-id" } });
  const updates: Array<Record<string, unknown>> = [];
  const rows: Record<string, unknown> = {
    outbound_email_jobs: { campaign_id: "campaign", requested_by: "admin@example.com", template_hash: outboundTemplateHash(template), locale: "id" },
    acquisition_campaigns: { id: "campaign", source_id: "source", channel: "email", status: "approved", approved_by: "admin", approved_at: "2026-10-06" },
    acquisition_sources: { ...source, status: "approved", active: true, channel: "outbound", approved_by: "admin", approved_at: "2026-10-06", privacy_notice_url: "https://example.com/privacy", data_owner: "owner", legal_owner: "owner" },
    pilot_release_recipients: [{ email: prospect.email }],
    acquisition_prospects: { ...prospect, ...(options.optedOut ? { consent_status: "opted_out" } : {}) },
    prospect_import_batches: batch,
    outbound_campaign_links: { id: "tracking-link" },
  };
  const rpc = vi.fn(async () => ({ data: [{ id: "delivery", job_id: "job", campaign_id: "campaign", kind: "initial", prospect_id: prospect.id, email: prospect.email, name: prospect.name, company: prospect.company }], error: null }));
  const from = (table: string) => {
    let update: Record<string, unknown> | undefined;
    const result = () => ({ data: rows[table] || null, error: options.saveFailed && update?.status === "sent" ? { message: "DB write lost" } : null });
    const query = {
      select: () => query, eq: () => query,
      insert: () => query,
      update: (value: Record<string, unknown>) => { update = value; updates.push(value); return query; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  mocks.db.mockReturnValue({ from, rpc });
  return { updates, rpc };
}

describe("outbound delivery worker", () => {
  it("persists provider acceptance and uses a stable per-delivery idempotency key", async () => {
    const { updates, rpc } = workerFixture();
    expect(await processOutboundQueue("job", "campaign")).toEqual({ processed: 1, deferred: false });
    expect(rpc).toHaveBeenCalledWith("claim_outbound_email", { p_job_id: "job", p_campaign_id: "campaign", p_limit: 1 });
    expect(mocks.send.mock.calls[0][5]).toEqual({ idempotencyKey: "outbound-initial-delivery", category: "marketing_initial" });
    expect(updates).toContainEqual(expect.objectContaining({ status: "sent", provider_email_id: "provider-id" }));
  });
  it.each([{ templateChanged: true }, { optedOut: true }])("rechecks approval and recipient data immediately before sending: %j", async (options) => {
    const { updates } = workerFixture(options); await processOutboundQueue();
    expect(mocks.send).not.toHaveBeenCalled(); expect(updates).toContainEqual(expect.objectContaining({ status: "blocked" }));
  });
  it("holds a provider timeout rather than retrying or claiming delivery", async () => {
    const { updates } = workerFixture(); mocks.send.mockRejectedValue(new Error("Provider timeout"));
    expect(await processOutboundQueue()).toMatchObject({ processed: 0 });
    expect(mocks.send).toHaveBeenCalledOnce(); expect(updates).toContainEqual(expect.objectContaining({ status: "uncertain" }));
    expect(updates.some((row) => row.status === "sent")).toBe(false);
  });
  it("holds an accepted send whose database confirmation could not be saved", async () => {
    const { updates } = workerFixture({ saveFailed: true }); await processOutboundQueue();
    expect(mocks.send).toHaveBeenCalledOnce(); expect(updates.at(-1)?.status).toBe("uncertain");
  });
  it("does not call an empty provider response proof of acceptance", async () => {
    const { updates } = workerFixture(); mocks.send.mockResolvedValue({ data: null }); await processOutboundQueue();
    expect(updates.at(-1)?.status).toBe("uncertain");
  });
  it("treats the last-moment suppression guard as not sent, not uncertain", async () => {
    const { updates } = workerFixture(); mocks.send.mockRejectedValue(new OutreachSuppressedError()); await processOutboundQueue();
    expect(updates.at(-1)?.status).toBe("blocked");
  });
});
