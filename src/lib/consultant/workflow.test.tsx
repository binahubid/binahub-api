import { mkdirSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spinOptions, spinVisible, type SpinAnswers } from "@/lib/spin/form";
import { SPIN_DEFINITION } from "@/lib/spin/intake";
import { SPIN_CATALOG } from "@/lib/spin/catalog";
import type { ConsultantDetail } from "./schemas";

const db = vi.hoisted(() => ({ rpc: vi.fn(), row: vi.fn(), send: vi.fn() }));
vi.mock("server-only", () => ({}));
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
          eq: () => chain,
          single: () => db.row(table),
          maybeSingle: () => db.row(table),
        };
        return chain;
      },
    }),
  }),
}));
vi.mock("@/lib/email-service", () => ({
  sendOutreachEmail: db.send,
  OutreachSuppressedError: class extends Error {},
}));

import { buildConsultantProposal } from "./proposal";
import { consultantProposalPDF } from "./pdf";
import { processConsultantMessage, queueConsultantMessage } from "./messages";
import { OutreachSuppressedError } from "@/lib/email-service";

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
  (m) => m.dailyRateIdr === null && m.code !== "SS-27",
)!;

function sample() {
  const answers: SpinAnswers = {};
  for (const f of SPIN_DEFINITION.fields) {
    if (!f.required || !spinVisible(f, answers)) continue;
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
    ).toBeNull();
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
