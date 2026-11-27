import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spinOptions, spinVisible, type SpinAnswers } from "@/lib/spin/form";
import { SPIN_DEFINITION } from "@/lib/spin/intake";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
import type { ConsultantDetail } from "./schemas";

const db = vi.hoisted(() => ({ rpc: vi.fn(), row: vi.fn(), send: vi.fn(), eq: vi.fn(), ai: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai-provider", () => ({ callRoutedAI: db.ai }));
vi.mock("@/lib/consultant/membership", () => ({
  assertActiveConsultantMembership: vi.fn().mockResolvedValue(undefined),
  ConsultantMembershipError: class extends Error {},
}));
vi.mock("@/lib/supabase", () => ({
  createServerSupabase: () => ({
    rpc: db.rpc,
    from: (table: string) => ({
      select: () => {
        const chain = {
          eq: (field: string, value: unknown) => { db.eq(table, field, value); return chain; },
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          single: () => db.row(table),
          maybeSingle: () => Object.assign(Promise.resolve(db.row(table)), {
            overrideTypes: () => Promise.resolve(db.row(table)),
          }),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/email-service", () => ({
  sendOutreachEmail: db.send,
  outreachSenderHeader: (name: string) => `${name} <${process.env.EMAIL_FROM}>`,
  OutreachSuppressedError: class extends Error {},
}));

import { buildConsultantProposal } from "./proposal";
import { consultantProposalPDF } from "./pdf";
import { readConsultantRecommendation, recommendationCard, suggestConsultantPrograms } from "./recommendation";
import { requiresProposalPriceRefresh } from "./pricing";
import { getConsultantEmailIdentity, processConsultantMessage, queueConsultantMessage } from "./messages";
import { OutreachSuppressedError } from "@/lib/email-service";
import { readConsultation } from "./service";

const userId = "00000000-0000-4000-8000-000000000001";
const lead = "00000000-0000-4000-8000-000000000002";
const message = "00000000-0000-4000-8000-000000000003";
const proposal = "00000000-0000-4000-8000-000000000004";
const person = {
  name: "Rina Contoh",
  company: "PT Contoh Transformasi",
  email: "rina@example.invalid",
};
const member = {
  user_id: userId,
  active: true,
  email: "konsultan@example.invalid",
  display_name: "Alicia Konsultan",
};
const date = "2026-11-11T07:00:00.000Z";
const daily = SPIN_CATALOG.modules.find((m) => m.dailyRateIdr !== null)!;
const nondaily = SPIN_CATALOG.modules.find(
  (m) => m.dailyRateIdr === null && m.pricingModel !== "Paket Standar" && m.code !== "SS-27",
)!;

function sample(overrides: SpinAnswers = {}) {
  const answers: SpinAnswers = {};
  for (const f of SPIN_DEFINITION.fields) {
    if (!spinVisible(f, answers)) continue;
    if (overrides[f.key] !== undefined) {
      answers[f.key] = overrides[f.key];
      continue;
    }
    if (!f.required) continue;
    if (f.type === "text")
      answers[f.key] =
        "Tim perlu menyepakati cara kerja lintas fungsi dan mengurangi pekerjaan yang berulang.";
    else if (f.type === "number") answers[f.key] = 20;
    else {
      const option = spinOptions(f, answers)[0];
      answers[f.key] = f.type === "multi" ? [option.value] : option.value;
    }
  }
  const detail: ConsultantDetail = {
    record: {
      ...person,
      id: lead,
      phone: "",
      stage: "consultation",
      nextAction: null,
      nextActionDueAt: null,
      assigneeId: userId,
      assigneeName: member.display_name,
      version: 2,
      assignmentRevision: 1,
      canEdit: true,
      checklistStatus: "completed",
      handoff: null,
      updatedAt: date,
    },
    workspace: {
      lead_id: lead,
      assignee_id: userId,
      assignment_revision: 1,
      version: 2,
      checklist_revision: 1,
      source_id: null,
      original_answers: {},
      answers,
      notes: "Catatan internal",
      checklist_status: "completed",
      updated_at: date,
    },
    proposals: [],
  };
  const input = {
    version: 2,
    programCodes: [daily.code],
    days: 2,
    participants: 20,
    venue: "outdoor",
    location: "Jakarta",
    scopeNote: "Sesi praktik dan refleksi tim.",
  };
  return { detail, input };
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    OUTBOUND_EMAIL_FORCE_DISABLED: "false",
    RESEND_API_KEY: "re_synthetic_test",
    EMAIL_FROM: "email@example.invalid",
    UNSUBSCRIBE_SECRET: "synthetic-secret-".repeat(3),
    NEXT_PUBLIC_BINAHUB_API_URL: "https://api.example.invalid",
  }))
    vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());

describe("Consultant proposal and email workflow", () => {
  it("prefills duration and headcount from the latest checklist answers", async () => {
    const { detail } = sample();
    detail.workspace!.original_answers = { countStatus: "known", participantCount: 30, duration: "one" };
    detail.workspace!.answers = { approaches: ["A1"], participantCount: 32, duration: "two" };
    db.rpc.mockResolvedValue({ data: detail, error: null });
    const current = await readConsultation(userId, lead);
    expect(current.proposalDefaults).toMatchObject({ participants: 32, days: 2 });

    detail.workspace!.answers.countStatus = "unknown";
    detail.workspace!.answers.duration = "unknown";
    const unknown = await readConsultation(userId, lead);
    expect(unknown.proposalDefaults.participants).toBeUndefined();
    expect(unknown.proposalDefaults.days).toBeUndefined();
  });

  it("uses the daily catalog rate × days, keeps indoor/outdoor equal, and retains unknown prices", () => {
    const { detail, input } = sample();
    const outdoor = buildConsultantProposal(detail, input, member.display_name);
    expect(outdoor.snapshot.total).toBe(daily.dailyRateIdr! * 2);
    expect(outdoor.snapshot.total).toBe(
      buildConsultantProposal(
        detail,
        { ...input, venue: "indoor" },
        member.display_name,
      ).snapshot.total,
    );
    expect(
      buildConsultantProposal(
        detail,
        { ...input, programCodes: [nondaily.code] },
        member.display_name,
      ).snapshot.total,
    ).toBeNull();
    expect(
      buildConsultantProposal(
        detail,
        { ...input, participants: 31 },
        member.display_name,
      ).snapshot.total,
    ).toBe(daily.dailyRateIdr! * 2 * 2);
    expect(
      buildConsultantProposal(detail, input, member.display_name).hash,
    ).toBe(outdoor.hash);
    expect(JSON.stringify(outdoor.snapshot)).not.toContain("Catatan internal");
    expect(() =>
      buildConsultantProposal(
        { ...detail, record: { ...detail.record, canEdit: false } },
        input,
        member.display_name,
      ),
    ).toThrow("CONSULTANT_NOT_ASSIGNED");
  });

  it.each([
    [30, 1, 25000000, "Essential"],
    [31, 1, 25450000, "Essential"],
    [32, 1, 25900000, "Essential"],
    [32, 2, 51800000, "Essential"],
    [40, 1, 29500000, "Essential"],
    [40, 2, 59000000, "Essential"],
    [41, 1, 50000000, "Signature"],
    [50, 1, 50000000, "Signature"],
    [50, 2, 100000000, "Signature"],
    [80, 1, 50000000, "Signature"],
    [81, 1, 75000000, "Enterprise"],
    [150, 1, 75000000, "Enterprise"],
    [151, 1, 75450000, "Enterprise"],
    [170, 2, 168000000, "Enterprise"],
    [10, 0.5, 25000000, "Essential"],
  ])("prices Team Building for %i people and %i days as Rp%i", (participants, days, total, tier) => {
    const { detail, input } = sample();
    const { snapshot } = buildConsultantProposal(detail, { ...input, participants, days, programCodes: ["SS-11"] }, member.display_name);
    expect(snapshot.total).toBe(total);
    expect(snapshot.programs[0].priceBasis).toContain(tier);
  });

  it("keeps a known subtotal when one program needs a custom quote", () => {
    const { detail, input } = sample();
    const { snapshot } = buildConsultantProposal(detail, {
      ...input, days: 1, participants: 50, programCodes: ["SS-11", nondaily.code],
    }, member.display_name);
    expect(snapshot).toMatchObject({ total: null, pricedSubtotal: 50000000, documentKind: "formal" });
  });

  it("flags a draft when its stored Team Building estimate differs from the approved rule", () => {
    const { detail, input } = sample();
    const { snapshot } = buildConsultantProposal(detail, {
      ...input, participants: 32, days: 1, programCodes: ["SS-11"],
    }, member.display_name);
    expect(snapshot.programs[0].priceBasis).toContain("2 peserta × Rp450.000");
    expect(snapshot.programs[0].capacity).toContain("Signature: 41–80");
    expect(requiresProposalPriceRefresh(snapshot)).toBe(false);
    expect(requiresProposalPriceRefresh({
      ...snapshot, programs: [{ code: "SS-11", total: 50000000 }], total: 50000000,
    })).toBe(true);
    expect(requiresProposalPriceRefresh({
      ...snapshot, documentKind: undefined, programs: [{ code: "SS-11", total: null }], total: null,
    })).toBe(true);
  });

  it("reuses a sent recommendation from the same lead without redelivering it", async () => {
    const { detail } = sample();
    const id = "00000000-0000-4000-8000-000000000009";
    detail.workspace!.source_id = id;
    const bytes = Buffer.from("%PDF-1.7 initial").toString("base64");
    const originalAnswers = { ...detail.workspace!.answers };
    db.row.mockImplementation(async (table) => ({
      error: null,
      data: table === "spin_submissions" ? {
        id, submitted_at: date, status: "ready", question_version: SPIN_DEFINITION.version, answers: originalAnswers,
        report: {
          version: "spin-report-v3-v1", reference: id, issuedAt: date, company: person.company,
          summary: { situation: "", problem: "", impact: "", outcome: "" }, snapshot: [], investments: [],
          confirmations: [], nextStep: "", bookingUrl: null, taxNote: "", disclaimer: "",
          solutions: [{ code: "SS-11", name: "Team Building", components: [], outputs: [], evidence: [{ need: "Kolaborasi tim", objective: "Mengoordinasikan kontribusi tim" }] }],
        },
      } : { status: "sent", sent_at: date, pdf_base64: bytes },
    }));
    const initial = await readConsultantRecommendation(detail, true);
    expect(initial?.pdf).toBe(bytes);
    expect(recommendationCard(detail, initial!)).toMatchObject({
      sentAt: date, delivery: "sent", programs: [{ code: "SS-11", name: "Team Building" }],
    });
    expect(db.eq).toHaveBeenCalledWith("spin_submissions", "lead_id", lead);
    expect(db.eq).toHaveBeenCalledWith("spin_submissions", "contact->>email", person.email);
    expect(db.eq).toHaveBeenCalledWith("spin_submissions", "id", id);
    expect(db.eq).toHaveBeenCalledWith("spin_mail_jobs", "submission_id", id);
    detail.workspace!.answers.participantCount = 50;
    detail.workspace!.answers.duration = "two";
    db.row.mockClear();
    expect(await suggestConsultantPrograms(detail, 2)).toMatchObject({
      source: "initial", status: "suggested", programs: [{ code: "SS-11" }],
    });
    expect(db.row).not.toHaveBeenCalledWith("spin_mail_jobs");
    expect(db.ai).not.toHaveBeenCalled();
    await expect(suggestConsultantPrograms({ ...detail, record: { ...detail.record, canEdit: false } }, 2))
      .rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
    expect(db.send).not.toHaveBeenCalled();
  });

  it("offers a catalog option to review when matching and the initial source are unavailable", async () => {
    const { detail } = sample({
      problemCluster: "C2", symptoms: ["S3"], venue: "indoor",
      desiredOutcome: "Anggota tim berani menyampaikan perbedaan dan membahasnya secara terbuka.",
    });
    db.row.mockResolvedValue({ data: null, error: { code: "unavailable" } });
    db.ai.mockRejectedValue(new Error("Provider unavailable"));
    await expect(suggestConsultantPrograms(detail, 2)).resolves.toMatchObject({
      source: "catalog", status: "review", programs: [{ code: "SS-12", reason: expect.stringContaining("kepercayaan") }],
    });
    expect(db.ai).toHaveBeenCalledOnce();
    expect(db.row).not.toHaveBeenCalledWith("spin_mail_jobs");
    expect(db.send).not.toHaveBeenCalled();
  });

  it("keeps a verified empty result when the AI finds no suitable program", async () => {
    const { detail } = sample();
    db.row.mockResolvedValue({ data: null, error: null });
    db.ai.mockResolvedValue({ content: '{"matches":[]}' });
    await expect(suggestConsultantPrograms(detail, 2)).resolves.toEqual({
      source: "checklist", status: "none", programs: [],
    });
    expect(db.ai).toHaveBeenCalledOnce();
  });

  it("does not guess a catalog option when the checklist has no specific symptom", async () => {
    const { detail } = sample();
    detail.workspace!.answers.symptoms = ["unknown"];
    db.row.mockResolvedValue({ data: null, error: null });
    db.ai.mockRejectedValue(new Error("Provider unavailable"));
    await expect(suggestConsultantPrograms(detail, 2)).resolves.toEqual({
      source: "checklist", status: "unavailable", programs: [],
    });
  });

  it("renders a PDF for a proposal with several programs and unpriced items", async () => {
    const { detail, input } = sample();
    const { snapshot } = buildConsultantProposal(
      detail,
      { ...input, programCodes: [daily.code, nondaily.code] },
      member.display_name,
    );
    const bytes = await consultantProposalPDF(snapshot, 1);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(10000);
    if (process.env.CONSULTANT_PDF_FIXTURE === "true") {
      mkdirSync("tmp/pdfs", { recursive: true });
      writeFileSync("tmp/pdfs/consultant-proposal-synthetic.pdf", bytes);
    }
  });

  it("previews from, recipient, and reply-to for assigned work only", async () => {
    const { detail } = sample();
    db.row.mockResolvedValue({ data: member, error: null });
    await expect(getConsultantEmailIdentity({ ...detail, record: { ...detail.record, canEdit: false } }))
      .rejects.toThrow("CONSULTANT_NOT_ASSIGNED");
    expect(db.row).not.toHaveBeenCalled();
    await expect(getConsultantEmailIdentity(detail)).resolves.toEqual({
      from: `${member.display_name} | BinaHub <email@example.invalid>`,
      to: person.email,
      replyTo: member.email,
    });
    expect(db.send).not.toHaveBeenCalled();
  });

  it("binds email identity and destination to the current work and cannot send directly from the route", async () => {
    const { detail } = sample();
    db.row.mockResolvedValue({ data: member, error: null });
    db.rpc.mockResolvedValue({ data: { id: message }, error: null });
    const input = {
      id: message,
      version: 2,
      kind: "follow_up",
      proposalId: null,
      subject: "Tindak lanjut",
      body: "Isi pesan",
      scheduledAt: date,
    };
    await queueConsultantMessage(userId, lead, detail, input);
    expect(db.rpc).toHaveBeenCalledWith(
      "consultant_queue_message",
      expect.objectContaining({
        p_actor: userId,
        p_lead: lead,
        p_envelope: expect.objectContaining({
          to: person.email,
          replyTo: member.email,
          senderId: userId,
          senderName: member.display_name,
        }),
      }),
    );
    await expect(
      queueConsultantMessage(userId, lead, detail, {
        ...input,
        to: "other@example.invalid",
      }),
    ).rejects.toThrow();
    expect(db.send).not.toHaveBeenCalled();
  });

  function claimedMessage() {
    const { detail, input } = sample();
    const snapshot = buildConsultantProposal(
      detail,
      input,
      member.display_name,
    ).snapshot;
    db.rpc.mockImplementation(async (method, args) => ({
      error: null,
      data:
        method === "consultant_claim_message"
          ? {
              id: message,
              lead_id: lead,
              proposal_id: proposal,
              lease_token: args.p_lease,
              envelope: {
                name: person.name,
                company: person.company,
                to: person.email,
                senderId: userId,
                senderName: member.display_name,
                replyTo: member.email,
                subject: "Proposal uji",
                body: "Paragraf pertama\n<Paragraf kedua>",
              },
            }
          : true,
    }));
    db.row.mockImplementation(async (table) => ({
      error: null,
      data:
        table === "consultant_members"
          ? member
          : table === "leads"
            ? person
            : { revision: 1, snapshot },
    }));
  }

  it("sends the reviewed content and PDF once with the assigned consultant identity", async () => {
    claimedMessage();
    db.send.mockResolvedValue({ data: { id: "provider-accepted" } });
    expect(await processConsultantMessage()).toEqual({
      processed: true,
      status: "accepted",
    });
    expect(db.send).toHaveBeenCalledOnce();
    expect(db.send).toHaveBeenCalledWith(
      person.email,
      person.name,
      "Proposal uji",
      expect.stringContaining("&lt;Paragraf kedua&gt;"),
      person.company,
      expect.objectContaining({
        idempotencyKey: `consultant/${message}`,
        senderName: `${member.display_name} | BinaHub`,
        replyTo: member.email,
        attachments: [
          expect.objectContaining({
            filename: "BinaHub-Proposal-r1.pdf",
            content: expect.any(Buffer),
          }),
        ],
      }),
    );
  });

  it("holds ambiguous provider outcomes and respects recipient suppression", async () => {
    claimedMessage();
    db.send
      .mockRejectedValueOnce(new Error("Provider did not acknowledge"))
      .mockRejectedValueOnce(new OutreachSuppressedError());
    expect(await processConsultantMessage()).toEqual({
      processed: true,
      status: "uncertain",
    });
    expect(await processConsultantMessage()).toEqual({
      processed: true,
      status: "cancelled",
    });
    vi.stubEnv("OUTBOUND_EMAIL_FORCE_DISABLED", "true");
    expect(await processConsultantMessage()).toEqual({
      processed: false,
      status: "paused",
    });
    expect(db.send).toHaveBeenCalledTimes(2);
  });
});
