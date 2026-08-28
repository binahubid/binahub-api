import { describe, expect, it } from "vitest";
import {
  assessmentActionSchema,
  assessmentStatusUpdateSchema,
  contactUpdateSchema,
  inquiryUpdateSchema,
  proposalDraftSchema,
} from "./admin-mutation-schemas";

const id = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("admin mutation schemas", () => {
  it("accepts known dashboard mutations", () => {
    expect(contactUpdateSchema.safeParse({ id, status: "Qualified", notes: "Siap dihubungi" }).success).toBe(true);
    expect(inquiryUpdateSchema.safeParse({ id, status: "Dibalas", notes: "Sudah dibalas" }).success).toBe(true);
    expect(assessmentStatusUpdateSchema.safeParse({
      id,
      assessmentStatus: "Result Email Terkirim",
      proposalStatus: "Belum Diminta",
    }).success).toBe(true);
    expect(assessmentActionSchema.safeParse({ id, action: "send_proposal" }).success).toBe(true);
  });

  it("rejects arbitrary statuses, actions, IDs, and oversized notes", () => {
    expect(contactUpdateSchema.safeParse({ id, status: "super-admin", notes: "" }).success).toBe(false);
    expect(inquiryUpdateSchema.safeParse({ id, status: "drop table", notes: "" }).success).toBe(false);
    expect(assessmentActionSchema.safeParse({ id, action: "delete_everything" }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ id: "not-a-uuid", status: "Qualified", notes: "" }).success).toBe(false);
    expect(contactUpdateSchema.safeParse({ id, status: "Qualified", notes: "x".repeat(4001) }).success).toBe(false);
  });

  it("accepts the explicit Business Rules proposal context and rejects unknown fields", () => {
    const base = {
      assessmentId: id,
      moduleItems: [{ catalogModuleId: id, quantity: 1 }],
      scopeType: "standard" as const,
      proposalContext: {
        organizationName: "PT Contoh",
        problemOrNeed: "Kebutuhan transformasi kepemimpinan",
        objective: "Menyiapkan pemimpin lini",
        participantEstimate: "30 orang",
        targetAudience: "Manager lini",
        scope: "Workshop dan coaching",
        timeline: "Q4 2026",
        decisionMakerOrSponsor: "HR Director",
        budgetIndication: "Rp75-100 juta",
        deliveryLocationOrMode: "Jakarta, onsite",
        expectedOutcome: "Pipeline pemimpin siap",
        nextStep: "Konsultasi 30 menit",
      },
    };
    expect(proposalDraftSchema.safeParse(base).success).toBe(true);
    expect(proposalDraftSchema.safeParse({ ...base, proposalContext: { ...base.proposalContext, invented: "no" } }).success).toBe(false);
  });
});
