import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  single: vi.fn(),
  pdf: vi.fn(),
}));

vi.mock("@/lib/secure-token", () => ({ verifyProposalViewToken: mocks.verify }));
vi.mock("@/lib/pdf-service", () => ({ generateProposalPDFBuffer: mocks.pdf }));
vi.mock("@/lib/supabase", () => ({
  createServerSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ single: mocks.single }),
      }),
    }),
  }),
}));

import { GET } from "./route";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const request = (suffix = "") => new NextRequest(
  `https://api.binahub.id/api/proposal/view?assessmentId=${assessmentId}&token=valid${suffix}`,
);

const storedProposal = {
  form_data: {
    name: "Rani",
    email: "rani@example.com",
    company: "Acme",
    challenge: "Leadership pipeline",
    locale: "id",
  },
  proposal_data: {
    documentKind: "preliminary",
    proposalType: "standard",
    proposedProgram: "Leadership Essentials",
    scope: ["Workshop"],
    commercialSnapshot: {
      items: [{ name: "Leadership Essentials", quantity: 2, pricingUnit: "batch", basePrice: 10_000_000, lineTotal: 20_000_000 }],
      totalBeforeTax: 20_000_000,
      currency: "IDR",
      validityDays: 14,
    },
  },
  proposal_status: "Terkirim",
  proposal_sent_at: "2026-10-01T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockReturnValue(true);
  mocks.single.mockResolvedValue({ data: storedProposal, error: null });
  mocks.pdf.mockResolvedValue(Buffer.from("pdf"));
});

describe("proposal view delivery", () => {
  it("rejects invalid links before reading the database", async () => {
    mocks.verify.mockReturnValue(false);
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(mocks.single).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns only the client-facing proposal snapshot", async () => {
    const response = await GET(request());
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.company).toBe("Acme");
    expect(payload.proposal.commercialSnapshot.items[0]).toEqual({
      name: "Leadership Essentials",
      quantity: 2,
      pricingUnit: "batch",
    });
    expect(payload.proposal.commercialSnapshot.totalBeforeTax).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("rani@example.com");
    expect(JSON.stringify(payload)).not.toContain("basePrice");
  });

  it("generates the downloadable PDF from the immutable sent timestamp", async () => {
    const response = await GET(request("&format=pdf"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(mocks.pdf).toHaveBeenCalledWith(
      storedProposal.form_data,
      storedProposal.proposal_data,
      "id",
      storedProposal.proposal_sent_at,
    );
  });

  it("does not expose drafts that have not been sent", async () => {
    mocks.single.mockResolvedValue({
      data: { ...storedProposal, proposal_status: "Sedang Disusun", proposal_sent_at: null },
      error: null,
    });
    expect((await GET(request())).status).toBe(404);
  });
});
