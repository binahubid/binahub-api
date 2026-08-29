import { describe, expect, it } from "vitest";
import {
  accountHealthReviewSchema,
  acquisitionBatchReviewSchema,
  acquisitionBatchSchema,
  acquisitionCampaignSchema,
  acquisitionSourceSchema,
  assessmentActionSchema,
  assessmentStatusUpdateSchema,
  clientAccountUpdateSchema,
  clientHandoffSchema,
  contactUpdateSchema,
  deliveryMilestoneSchema,
  deliveryProjectUpdateSchema,
  inquiryUpdateSchema,
  operationalTaskUpdateSchema,
  proposalDraftSchema,
  retentionOpportunitySchema,
  uatScenarioUpdateSchema,
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

  it("requires human-owned evidence for Phase 9 UAT outcomes", () => {
    const base = {
      scenarioId: id,
      owner: "tester@binahub.id",
      environment: "staging" as const,
      evidenceNote: "Screenshot dan execution log tersimpan.",
      evidenceUrl: "https://evidence.binahub.id/uat/1",
      actualResult: "Hasil sesuai ekspektasi skenario.",
      blockerReason: null,
    };
    expect(uatScenarioUpdateSchema.safeParse({ ...base, status: "passed" }).success).toBe(true);
    expect(uatScenarioUpdateSchema.safeParse({ ...base, status: "passed", actualResult: "" }).success).toBe(false);
    expect(uatScenarioUpdateSchema.safeParse({ ...base, status: "in_progress", owner: null }).success).toBe(false);
    expect(uatScenarioUpdateSchema.safeParse({
      ...base,
      status: "blocked",
      evidenceNote: null,
      evidenceUrl: null,
      actualResult: null,
      blockerReason: "Menunggu keputusan pihak terkait.",
    }).success).toBe(true);
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

  it("enforces ownership and risk context for Phase 3 handoff and delivery", () => {
    expect(clientHandoffSchema.safeParse({
      leadId: id,
      commercialOwner: "sales@binahub.id",
      deliveryOwner: "delivery@binahub.id",
      projectTitle: "Initial Delivery",
    }).success).toBe(true);
    expect(clientHandoffSchema.safeParse({
      leadId: id,
      commercialOwner: "",
      deliveryOwner: "delivery@binahub.id",
      projectTitle: "Initial Delivery",
    }).success).toBe(false);
    expect(deliveryProjectUpdateSchema.safeParse({
      projectId: id,
      deliveryStage: "at_risk",
      deliveryOwner: "delivery@binahub.id",
      successMetrics: [],
      riskLevel: "high",
      riskSummary: "",
    }).success).toBe(false);
    expect(deliveryMilestoneSchema.safeParse({
      projectId: id,
      title: "Kickoff",
      owner: "delivery@binahub.id",
      status: "blocked",
      progress: 20,
      weight: 10,
      blockerReason: "",
    }).success).toBe(false);
  });

  it("requires reasons, next actions, and human approval at Phase 3 gates", () => {
    expect(clientAccountUpdateSchema.safeParse({
      clientAccountId: id,
      status: "churned",
      commercialOwner: "sales@binahub.id",
      deliveryOwner: "delivery@binahub.id",
      retainStatus: "churned",
      changeReason: "",
    }).success).toBe(false);
    expect(accountHealthReviewSchema.safeParse({
      clientAccountId: id,
      deliveryScore: 2,
      engagementScore: 2,
      sentimentScore: 1,
      commercialScore: 2,
      riskLevel: "critical",
      riskReasons: ["Sponsor tidak aktif"],
    }).success).toBe(false);
    expect(retentionOpportunitySchema.safeParse({
      clientAccountId: id,
      opportunityType: "repeat",
      status: "proposal",
      owner: "sales@binahub.id",
      moduleRequestData: {},
      nextAction: "Review proposal",
      nextActionDueAt: "2026-09-10T09:00:00+07:00",
      humanApproved: false,
    }).success).toBe(false);
  });

  it("keeps Phase 4 operational tasks human-owned and auditable", () => {
    expect(operationalTaskUpdateSchema.safeParse({
      taskId: id,
      status: "in_progress",
      priority: "high",
      assignedTo: "operations@binahub.id",
      dueAt: "2026-09-01T09:00:00+07:00",
    }).success).toBe(true);
    expect(operationalTaskUpdateSchema.safeParse({
      taskId: id,
      status: "in_progress",
      priority: "high",
      assignedTo: null,
    }).success).toBe(false);
    expect(operationalTaskUpdateSchema.safeParse({
      taskId: id,
      status: "completed",
      priority: "medium",
      resolutionNote: "ok",
    }).success).toBe(false);
  });

  it("blocks Phase 5 acquisition until source and campaign gates are complete", () => {
    expect(acquisitionSourceSchema.safeParse({
      sourceKey: "apollo_id",
      name: "Apollo Indonesia",
      providerType: "apollo",
      channel: "outbound",
      acquisitionMethod: "Licensed CSV export",
      status: "approved",
      active: true,
      config: {},
      humanApproved: true,
      approvalNote: "Disetujui legal",
    }).success).toBe(false);
    expect(acquisitionCampaignSchema.safeParse({
      sourceId: id,
      campaignCode: "AWARENESS_2026",
      name: "Awareness 2026",
      objective: "awareness",
      channel: "linkedin",
      status: "active",
      owner: "growth@binahub.id",
      currency: "IDR",
      utmConfig: {},
      targetDefinition: {},
      humanApproved: true,
      approvalNote: "Disetujui untuk berjalan",
    }).success).toBe(false);
    expect(acquisitionBatchSchema.safeParse({
      sourceId: id,
      importKey: "batch-2026-08-29",
      prospects: [{ name: "Contoh", email: "prospect@example.com", consentStatus: "unknown" }],
    }).success).toBe(true);
    expect(acquisitionBatchReviewSchema.safeParse({ batchId: id, decision: "approved", note: "ok" }).success).toBe(false);
  });
});
