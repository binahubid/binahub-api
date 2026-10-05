import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SignatureProposalReport } from "./signature-proposal-report";
import { generateProposalPDFBuffer, type ProposalResult } from "./pdf-service";
import type { AssessmentData } from "./validations";

const sent = vi.hoisted(() => vi.fn<(payload: unknown) => Promise<{ data: { id: string }; error: null }>>().mockResolvedValue({ data: { id: "test-email" }, error: null }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sent }; } }));
vi.mock("./supabase", () => ({ createServerSupabase: vi.fn() }));
vi.mock("./secure-token", () => ({ createProposalToken: () => "test-token", createProposalViewToken: () => "test-view-token" }));
import { sendProposalEmail } from "./email-service";

const form = { name: "Nadia Putri", email: "nadia@example.com", company: "PT Aurora Nusantara", challenge: "Kolaborasi antartim perlu diperkuat.", locale: "id" } as AssessmentData;
const proposal: ProposalResult = {
  documentKind: "commercial", proposalType: "standard", subject: "Proposal Standar",
  proposedProgram: "Program Pengembangan Tim", opening: "Kami menyiapkan Proposal Standar berdasarkan prioritas tim Anda.",
  scope: ["Komunikasi lintas fungsi", "Kesepakatan kerja bersama"], deliverables: ["Rencana tindak lanjut tim"],
  learningObjectives: ["Menyelaraskan prioritas dan meningkatkan kolaborasi"],
  selectedSolutions: [{ code: "SS-12", name: "Komunikasi dan Kolaborasi Tim", focus: "Mengembangkan kebiasaan kerja yang lebih terbuka." }],
  timeline: "Durasi katalog: 1 hari. Pelaksanaan lebih lama memerlukan penawaran ulang.",
  investmentNote: "Harga dasar katalog: Rp 25.000.000 untuk Komunikasi Tim (1 hari pelaksanaan). Pajak dikonfirmasi terpisah.",
  nextStep: "Balas email ini untuk mengonfirmasi jadwal dan kebutuhan pelaksanaan.",
  commercialSnapshot: { items: [{ name: "Komunikasi Tim", quantity: 1, pricingUnit: "day", basePrice: 25_000_000, lineTotal: 25_000_000 }], subtotal: 25_000_000, discountPercent: 0, discountAmount: 0, totalBeforeTax: 25_000_000, currency: "IDR", validityDays: 14 },
};
const forbidden = /proposal standar|proposal custom|standard proposal|custom proposal|catalog base|katalog|snapshot|persetujuan manusia|persetujuan internal|human approval|human review|internal approval/i;

describe("public proposal templates", () => {
  it.each(["id", "en"] as const)("keeps PDF copy client-friendly in %s for old stored proposals", (locale) => {
    const html = renderToStaticMarkup(<SignatureProposalReport formData={form} proposal={proposal} locale={locale} issuedAt="2026-10-05T03:00:00Z" />);
    expect(html).not.toMatch(forbidden);
    expect(html).toContain("25");
    expect(html).toContain("14");
    expect(html).toContain("SS-12");
  });
  it("does not print custom classification or approval gates", () => {
    expect(renderToStaticMarkup(<SignatureProposalReport formData={form} proposal={{ ...proposal, proposalType: "custom" }} issuedAt="2026-10-05T03:00:00Z" />)).not.toMatch(forbidden);
  });
  it.each(["id", "en"] as const)("uses a neutral email subject and body in %s without real delivery", async (locale) => {
    await sendProposalEmail(form.email, form.name, form.company, proposal, "test-id", locale);
    const payload = sent.mock.calls.at(-1)?.[0] as unknown as { subject: string; html: string };
    expect(payload.subject).not.toMatch(forbidden);
    expect(payload.html).not.toMatch(forbidden);
    expect(payload.html).toContain("25.000.000");
  });
  it("renders both PDF locales using the actual application renderer", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    for (const locale of ["id", "en"] as const) {
      const buffer = await generateProposalPDFBuffer(form, proposal, locale, "2026-10-05T03:00:00Z");
      expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
      if (process.env.PROPOSAL_COPY_QA_DIR) {
        await mkdir(process.env.PROPOSAL_COPY_QA_DIR, { recursive: true });
        await writeFile(`${process.env.PROPOSAL_COPY_QA_DIR}/proposal-copy-${locale}.pdf`, buffer);
      }
    }
  }, 60_000);
});
