import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: vi.fn(), select: vi.fn(), generate: vi.fn(), send: vi.fn(), observe: vi.fn() }));
vi.mock("./supabase", () => ({ createServerSupabase: mocks.db }));
vi.mock("./ai-service", () => ({ selectStandardCatalogModules: mocks.select, generateAssessmentProposal: mocks.generate }));
vi.mock("./email-service", () => ({ sendProposalEmail: mocks.send }));
vi.mock("./runtime-observability", () => ({ recordRuntimeError: mocks.observe }));
import { createAndSendAutomaticPreliminary } from "./automatic-preliminary";
import { requestStandardProposal } from "./standard-proposal-request";

const standard = { id: "module-12", module_code: "SS-12", name: "Kepercayaan dan Keamanan Psikologis", standard_scope: "Dialog terbuka\nResolusi konflik", deliverables: "Rencana tindak lanjut", duration_label: "1 hari", pricing_unit: "day", base_price: 25_000_000, minimum_quantity: 1, catalog_version: "signature-2026-ceo-v1", metadata: { commercialModel: "fixed_daily", requiresHumanCommercialReview: false } };
const assessment = () => ({ id: "assessment-1", lead_id: "lead-1", form_data: { name: "Test User", email: "internal@example.com", company: "Test Company", locale: "id", challenge: "Konflik internal", target: "Tim kompak", answers: Object.fromEntries(Array.from({ length: 49 }, (_, i) => [String(i + 1), 3])) }, scores: { Insights: 57, Lab: 57, Coach: 60, Play: 57, Academy: 66, Works: 71, Impact: 66, overall: 62 }, ai_analysis: "Analisis lintas dimensi memperlihatkan bahwa tim memerlukan ruang dialog, kepercayaan, dan cara menyelesaikan konflik yang konsisten.", recommendations: ["Coach", "Play", "Lab"].map((service) => ({ title: "Perkuat koordinasi", description: "Jalankan langkah pengembangan sesuai hasil diagnosis organisasi.", service })), category: "Profesional", overall_score: 62, proposal_status: "Diminta", proposal_sent_at: null, proposal_requested_at: new Date().toISOString(), proposal_draft_data: null, proposal_catalog_version: null });

let state: { row: Record<string, unknown>; modules: Record<string, unknown>[]; catalogError: boolean; finalSaveError: boolean; failures: Record<string, unknown>[] };
function database() {
  return { from(table: string) {
    let patch: Record<string, unknown> | null = null;
    const filters: Array<[string, unknown]> = [];
    const matches = () => filters.every(([key, value]) => state.row[key] === value);
    const result = () => {
      if (table === "catalog_modules") return state.catalogError ? { data: null, error: { message: "catalog offline" } } : { data: state.modules, error: null };
      if (table === "assessments" && patch) {
        if (!matches()) return { data: null, error: null };
        if (patch.proposal_status === "Terkirim" && state.finalSaveError) return { data: null, error: { message: "DB unavailable after delivery" } };
        Object.assign(state.row, patch);
        return { data: { id: state.row.id }, error: null };
      }
      return { data: structuredClone(state.row), error: null };
    };
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { if (table === "assessments") filters.push([key, value]); return query; },
      is: (key: string, value: unknown) => { if (table === "assessments") filters.push([key, value]); return query; },
      order: () => query,
      update: (value: Record<string, unknown>) => { patch = value; return query; },
      insert: (value: Record<string, unknown>) => { state.failures.push(value); return query; },
      single: async () => result(), maybeSingle: async () => result(),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  } };
}

beforeEach(() => {
  vi.clearAllMocks();
  state = { row: assessment(), modules: [standard], catalogError: false, finalSaveError: false, failures: [] };
  mocks.db.mockImplementation(database);
  mocks.select.mockResolvedValue({ moduleCodes: ["SS-12"], reasoning: "Kepercayaan dibutuhkan untuk menangani konflik tim." });
  mocks.generate.mockResolvedValue({ subject: "Proposal", opening: "Program sesuai hasil diagnosa", proposedProgram: "Penguatan kepercayaan", scope: ["AI scope must be replaced"], timeline: "1 hari", investmentNote: "AI price must be replaced", nextStep: "Diskusikan jadwal" });
  mocks.send.mockResolvedValue({ data: { id: "email-1" } });
  mocks.observe.mockResolvedValue({ stored: true });
});

describe("automatic standard proposal workflow", () => {
  it("creates and emails an official standard proposal with exact catalog price and outputs", async () => {
    mocks.send.mockImplementation(async () => {
      expect(state.row.proposal_data).toBeTruthy();
      return { data: { id: "email-1" } };
    });
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "sent", emailId: "email-1" });
    expect(mocks.send.mock.calls[0][3]).toMatchObject({ proposalType: "standard", isSimulation: false, scope: ["Dialog terbuka", "Resolusi konflik"], deliverables: ["Rencana tindak lanjut"], commercialSnapshot: { totalBeforeTax: 25_000_000, discountPercent: 0 } });
    expect(state.row).toMatchObject({ proposal_status: "Terkirim", proposal_gate_status: "clear", proposal_email_id: "email-1" });
  });

  it("claims before AI work so concurrent clicks send only once", async () => {
    let finish!: (value: { moduleCodes: string[]; reasoning: string }) => void;
    mocks.select.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = createAndSendAutomaticPreliminary("assessment-1");
    await vi.waitFor(() => expect(mocks.select).toHaveBeenCalledOnce());
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "already_processing" });
    finish({ moduleCodes: ["SS-12"], reasoning: "Sesuai kebutuhan" });
    await first;
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("preserves all official scope and outputs instead of truncating the CEO catalog", async () => {
    const scope = Array.from({ length: 15 }, (_, index) => `Cakupan resmi ${index + 1}`);
    const outputs = Array.from({ length: 14 }, (_, index) => `Output resmi ${index + 1}`);
    state.modules = [{ ...standard, metadata: { ...standard.metadata, localized: { id: { contentOutline: scope, outputs } } } }];
    await createAndSendAutomaticPreliminary("assessment-1");
    expect(mocks.send.mock.calls[0][3]).toMatchObject({ scope, deliverables: outputs });
  });

  it("recovers an AI selection failure using relevant catalog evidence and still auto-sends", async () => {
    mocks.select.mockRejectedValue(new Error("AI timeout"));
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "sent" });
    expect(state.row.proposal_draft_data).toMatchObject({ selectionMethod: "assessment_catalog_match" });
    expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({ code: "STANDARD_PROPOSAL_SELECTION_FAILED" }));
  });

  it("holds an unsupported need rather than inventing a module", async () => {
    state.row.form_data = { ...assessment().form_data, challenge: "Butuh pembiayaan IPO", target: "Pinjaman modal" };
    mocks.select.mockRejectedValue(new Error("AI offline"));
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "manual_review" });
    expect(state.row.proposal_status).toBe("Menunggu Approval");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not send custom or incomplete catalog entries", async () => {
    state.modules = [{ ...standard, base_price: 0, pricing_unit: "custom" }];
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "manual_review" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records DB failure instead of leaving an invisible processing state", async () => {
    state.catalogError = true;
    await expect(createAndSendAutomaticPreliminary("assessment-1")).rejects.toThrow("catalog offline");
    expect(state.row.proposal_status).toBe("Gagal Otomatis");
    expect(state.failures).toHaveLength(1);
  });

  it("retries delivery with the same snapshot and idempotency key, not another AI proposal", async () => {
    mocks.send.mockRejectedValueOnce(new Error("temporary email error"));
    await expect(createAndSendAutomaticPreliminary("assessment-1")).rejects.toThrow();
    const first = mocks.send.mock.calls[0];
    expect(state.row.proposal_status).toBe("Gagal Otomatis");
    await createAndSendAutomaticPreliminary("assessment-1");
    expect(mocks.send.mock.calls[1]).toEqual(first);
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.generate).toHaveBeenCalledOnce();
  });

  it("never auto-retries an uncertain accepted email", async () => {
    state.finalSaveError = true;
    await expect(createAndSendAutomaticPreliminary("assessment-1")).rejects.toThrow();
    expect(state.row.proposal_status).toBe("Perlu Rekonsiliasi");
    expect(await requestStandardProposal("assessment-1", true)).toMatchObject({ outcome: "manual_review" });
    await createAndSendAutomaticPreliminary("assessment-1");
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("holds old delivery snapshots beyond the safe idempotency window", async () => {
    state.row.proposal_draft_data = { automatic: true, proposal: { subject: "Previously prepared" }, generatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() };
    state.row.proposal_catalog_version = standard.catalog_version;
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "manual_review" });
    expect(state.row.proposal_status).toBe("Perlu Rekonsiliasi");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not overwrite manual drafts or resend delivered proposals", async () => {
    state.row.proposal_draft_data = { proposal: { subject: "Manual" }, automatic: false };
    expect(await requestStandardProposal("assessment-1", true)).toMatchObject({ outcome: "manual_review" });
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "manual_review" });
    state.row.proposal_sent_at = new Date().toISOString();
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "already_sent" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("preserves a legacy manual draft even when stored as serialized JSON", async () => {
    state.row.proposal_status = "Sedang Disusun";
    state.row.proposal_draft_data = JSON.stringify({ proposal: { subject: "Legacy manual" } });
    expect(await requestStandardProposal("assessment-1", true)).toMatchObject({ outcome: "manual_review" });
    expect(await createAndSendAutomaticPreliminary("assessment-1")).toMatchObject({ outcome: "manual_review" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records a request without calling AI or sending an email inline", async () => {
    state.row.proposal_status = "Belum Diminta";
    expect(await requestStandardProposal("assessment-1")).toMatchObject({ outcome: "queued" });
    expect(state.row.proposal_status).toBe("Diminta");
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
