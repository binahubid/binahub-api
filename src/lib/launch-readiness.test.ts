import { describe, expect, it } from "vitest";
import { evaluateLaunchReadiness, type LaunchReadinessInput } from "./launch-readiness";

const baseInput: LaunchReadinessInput = {
  configuration: {
    followUpSecret: true,
    transformationWorkerSecret: true,
    operationsSecret: true,
    acquisitionSecret: true,
    resendApiKey: true,
    resendWebhookSecret: true,
    calBookingUrl: true,
    approvedTemplateRequired: true,
    followUpDryRun: true,
    transformationWorkerDryRun: true,
    operationsDryRun: true,
    acquisitionDryRun: true,
  },
  businessRules: {
    version: "v1",
    status: "active",
    isMock: false,
    outboundAutomationEnabled: true,
    activationBlockers: [],
  },
  catalog: { readyNonMockModules: 4, pricedReadyModules: 3 },
  templates: { required: 18, approvedNonMock: 18 },
  acquisition: { approvedActiveSources: 1, approvedOrActiveCampaigns: 1, approvedBatches: 1 },
  evidence: {
    latestRuns: {
      follow_up_scheduler: { status: "succeeded", dryRun: true, candidateCount: 2, processedCount: 0, failureCount: 0, startedAt: "2026-08-30T00:00:00Z", finishedAt: "2026-08-30T00:00:01Z", errorMessage: null },
      transformation_event_worker: { status: "succeeded", dryRun: true, candidateCount: 0, processedCount: 0, failureCount: 0, startedAt: "2026-08-30T00:00:00Z", finishedAt: "2026-08-30T00:00:01Z", errorMessage: null },
      client_operations_daily: { status: "succeeded", dryRun: true, candidateCount: 0, processedCount: 0, failureCount: 0, startedAt: "2026-08-30T00:00:00Z", finishedAt: "2026-08-30T00:00:01Z", errorMessage: null },
      acquisition_batch_processor: { status: "succeeded", dryRun: true, candidateCount: 1, processedCount: 0, failureCount: 0, startedAt: "2026-08-30T00:00:00Z", finishedAt: "2026-08-30T00:00:01Z", errorMessage: null },
    },
    emailDeliveryEventCount: 2,
    eventQueueFailedCount: 0,
    calendarBookingCount: 2,
    calendarLineageIssueCount: 0,
  },
};

describe("launch readiness", () => {
  it("marks all workflows as dry-run validated without enabling them", () => {
    const result = evaluateLaunchReadiness(baseInput);
    expect(result.overall).toMatchObject({
      state: "dry_run_validated",
      activationLocked: true,
      humanApprovalRequired: true,
      liveWorkflowCount: 0,
      validatedWorkflowCount: 4,
    });
    expect(result.workflows.every((workflow) => workflow.activationStatus === "eligible_for_human_review")).toBe(true);
  });

  it("keeps outbound locked when business rules and templates are incomplete", () => {
    const result = evaluateLaunchReadiness({
      ...baseInput,
      businessRules: { ...baseInput.businessRules, status: "draft", outboundAutomationEnabled: false, activationBlockers: ["official_module_catalog"] },
      templates: { required: 18, approvedNonMock: 0 },
      evidence: { ...baseInput.evidence, emailDeliveryEventCount: 0 },
    });
    const followUp = result.workflows.find((workflow) => workflow.key === "follow_up_scheduler");
    expect(result.overall.activationLocked).toBe(true);
    expect(followUp?.activationStatus).toBe("locked");
    expect(followUp?.blockers.map((item) => item.key)).toEqual(expect.arrayContaining([
      "business_rules_active",
      "outbound_enabled",
      "templates_ready",
      "delivery_evidence",
    ]));
  });

  it("raises a guard when any worker is already configured live", () => {
    const result = evaluateLaunchReadiness({
      ...baseInput,
      configuration: { ...baseInput.configuration, operationsDryRun: false },
    });
    const operations = result.workflows.find((workflow) => workflow.key === "client_operations_daily");
    expect(result.overall.state).toBe("live_guard_required");
    expect(operations?.technicalStatus).toBe("live_guard_required");
    expect(operations?.activationStatus).toBe("live_guard_required");
  });
});
