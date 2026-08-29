export type LaunchWorkflowKey =
  | "follow_up_scheduler"
  | "transformation_event_worker"
  | "client_operations_daily"
  | "acquisition_batch_processor";

export type LaunchRunEvidence = {
  status: string;
  dryRun: boolean;
  candidateCount: number;
  processedCount: number;
  failureCount: number;
  startedAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
};

export type LaunchReadinessInput = {
  configuration: {
    followUpSecret: boolean;
    transformationWorkerSecret: boolean;
    operationsSecret: boolean;
    acquisitionSecret: boolean;
    resendApiKey: boolean;
    resendWebhookSecret: boolean;
    calBookingUrl: boolean;
    approvedTemplateRequired: boolean;
    followUpDryRun: boolean;
    transformationWorkerDryRun: boolean;
    operationsDryRun: boolean;
    acquisitionDryRun: boolean;
  };
  businessRules: {
    version: string | null;
    status: string | null;
    isMock: boolean;
    outboundAutomationEnabled: boolean;
    activationBlockers: string[];
  };
  catalog: {
    readyNonMockModules: number;
    pricedReadyModules: number;
  };
  templates: {
    required: number;
    approvedNonMock: number;
  };
  acquisition: {
    approvedActiveSources: number;
    approvedOrActiveCampaigns: number;
    approvedBatches: number;
  };
  evidence: {
    latestRuns: Partial<Record<LaunchWorkflowKey, LaunchRunEvidence>>;
    emailDeliveryEventCount: number;
    eventQueueFailedCount: number;
    calendarBookingCount: number;
    calendarLineageIssueCount: number;
  };
};

export type LaunchReadinessCheck = {
  key: string;
  label: string;
  passed: boolean;
  category: "configuration" | "business" | "evidence" | "safety";
  detail: string;
};

export type LaunchWorkflowReadiness = {
  key: LaunchWorkflowKey;
  label: string;
  purpose: string;
  mode: "dry_run" | "live";
  technicalStatus: "configuration_required" | "dry_run_pending" | "dry_run_validated" | "failed" | "live_guard_required";
  activationStatus: "locked" | "eligible_for_human_review" | "live_guard_required";
  checks: LaunchReadinessCheck[];
  blockers: LaunchReadinessCheck[];
  lastRun: LaunchRunEvidence | null;
};

const check = (
  key: string,
  label: string,
  passed: boolean,
  category: LaunchReadinessCheck["category"],
  detail: string,
): LaunchReadinessCheck => ({ key, label, passed, category, detail });

function buildWorkflow(input: {
  key: LaunchWorkflowKey;
  label: string;
  purpose: string;
  dryRun: boolean;
  checks: LaunchReadinessCheck[];
  lastRun?: LaunchRunEvidence;
}) {
  const configurationFailed = input.checks.some((item) => item.category === "configuration" && !item.passed);
  const lastRunFailed = Boolean(input.lastRun && !["succeeded", "deferred"].includes(input.lastRun.status));
  const evidencePassed = Boolean(input.lastRun?.status === "succeeded" && input.lastRun.dryRun);
  const activationBlockers = input.checks.filter((item) => !item.passed);

  let technicalStatus: LaunchWorkflowReadiness["technicalStatus"] = "dry_run_pending";
  if (!input.dryRun) technicalStatus = "live_guard_required";
  else if (configurationFailed) technicalStatus = "configuration_required";
  else if (lastRunFailed) technicalStatus = "failed";
  else if (evidencePassed) technicalStatus = "dry_run_validated";

  let activationStatus: LaunchWorkflowReadiness["activationStatus"] = "locked";
  if (!input.dryRun) activationStatus = "live_guard_required";
  else if (technicalStatus === "dry_run_validated" && activationBlockers.length === 0) {
    activationStatus = "eligible_for_human_review";
  }

  return {
    key: input.key,
    label: input.label,
    purpose: input.purpose,
    mode: input.dryRun ? "dry_run" : "live",
    technicalStatus,
    activationStatus,
    checks: input.checks,
    blockers: activationBlockers,
    lastRun: input.lastRun || null,
  } satisfies LaunchWorkflowReadiness;
}

export function evaluateLaunchReadiness(input: LaunchReadinessInput) {
  const rulesReady = input.businessRules.status === "active"
    && !input.businessRules.isMock
    && input.businessRules.activationBlockers.length === 0;
  const templatesReady = input.templates.approvedNonMock >= input.templates.required;

  const followUpRun = input.evidence.latestRuns.follow_up_scheduler;
  const workerRun = input.evidence.latestRuns.transformation_event_worker;
  const operationsRun = input.evidence.latestRuns.client_operations_daily;
  const acquisitionRun = input.evidence.latestRuns.acquisition_batch_processor;

  const workflows: LaunchWorkflowReadiness[] = [
    buildWorkflow({
      key: "follow_up_scheduler",
      label: "Follow-up Scheduler",
      purpose: "Menyeleksi kandidat H+2/H+7/H+14 dan mengirim hanya setelah guardrail komersial serta deliverability disetujui.",
      dryRun: input.configuration.followUpDryRun,
      lastRun: followUpRun,
      checks: [
        check("follow_up_secret", "Credential scheduler tersedia", input.configuration.followUpSecret, "configuration", "Secret hanya dinilai tersedia/tidak; nilainya tidak pernah dikirim ke dashboard."),
        check("resend_api", "Resend siap mengirim", input.configuration.resendApiKey, "configuration", "API key Resend wajib tersedia pada runtime API."),
        check("resend_webhook", "Webhook deliverability terverifikasi", input.configuration.resendWebhookSecret, "configuration", "Signature webhook bounce/complaint wajib dapat diverifikasi."),
        check("cal_booking_url", "Tautan konsultasi tersedia", input.configuration.calBookingUrl, "configuration", "CTA konsultasi harus mengarah ke booking link resmi."),
        check("approved_template_enforced", "Template approved diwajibkan", input.configuration.approvedTemplateRequired, "safety", "Fallback AI tidak boleh mengirim pesan live tanpa template approved."),
        check("business_rules_active", "Business Rules aktif tanpa blocker", rulesReady, "business", `${input.businessRules.activationBlockers.length} blocker keputusan masih terbuka.`),
        check("outbound_enabled", "Outbound diizinkan Business Rules", input.businessRules.outboundAutomationEnabled, "business", "Izin outbound harus eksplisit, bukan disimpulkan dari deployment."),
        check("templates_ready", "Seluruh template final disetujui", templatesReady, "business", `${input.templates.approvedNonMock}/${input.templates.required} template non-mock approved.`),
        check("delivery_evidence", "Webhook email memiliki bukti production", input.evidence.emailDeliveryEventCount > 0, "evidence", `${input.evidence.emailDeliveryEventCount} delivery event tersimpan.`),
        check("dry_run_evidence", "Dry-run terakhir berhasil", Boolean(followUpRun?.status === "succeeded" && followUpRun.dryRun), "evidence", followUpRun ? `Run terakhir: ${followUpRun.status}.` : "Belum ada audit run pada database."),
      ],
    }),
    buildWorkflow({
      key: "transformation_event_worker",
      label: "Transformation Event Worker",
      purpose: "Memproses event internal secara idempotent dengan retry, lease, dan batas percobaan.",
      dryRun: input.configuration.transformationWorkerDryRun,
      lastRun: workerRun,
      checks: [
        check("worker_secret", "Credential worker tersedia", input.configuration.transformationWorkerSecret, "configuration", "Worker hanya menerima bearer token khusus."),
        check("event_queue_health", "Tidak ada event gagal permanen", input.evidence.eventQueueFailedCount === 0, "evidence", `${input.evidence.eventQueueFailedCount} event berstatus failed.`),
        check("dry_run_evidence", "Dry-run terakhir berhasil", Boolean(workerRun?.status === "succeeded" && workerRun.dryRun), "evidence", workerRun ? `Run terakhir: ${workerRun.status}.` : "Belum ada audit run pada database."),
      ],
    }),
    buildWorkflow({
      key: "client_operations_daily",
      label: "Client Operations Scheduler",
      purpose: "Membentuk human task untuk review account, delivery risk, milestone, dan renewal tanpa mengambil keputusan manusia.",
      dryRun: input.configuration.operationsDryRun,
      lastRun: operationsRun,
      checks: [
        check("operations_secret", "Credential Operations tersedia", input.configuration.operationsSecret, "configuration", "Endpoint scheduler memakai bearer token terpisah."),
        check("dry_run_evidence", "Dry-run terakhir berhasil", Boolean(operationsRun?.status === "succeeded" && operationsRun.dryRun), "evidence", operationsRun ? `Run terakhir: ${operationsRun.status}.` : "Belum ada audit run pada database."),
      ],
    }),
    buildWorkflow({
      key: "acquisition_batch_processor",
      label: "Acquisition Batch Processor",
      purpose: "Mempromosikan prospect yang sudah lolos legal, deduplikasi, suppression, dan human approval menjadi consumer lead.",
      dryRun: input.configuration.acquisitionDryRun,
      lastRun: acquisitionRun,
      checks: [
        check("acquisition_secret", "Credential Acquisition tersedia", input.configuration.acquisitionSecret, "configuration", "Endpoint processor memakai bearer token terpisah."),
        check("approved_source", "Sumber data legal disetujui", input.acquisition.approvedActiveSources > 0, "business", `${input.acquisition.approvedActiveSources} source approved dan aktif.`),
        check("approved_campaign", "Campaign disetujui", input.acquisition.approvedOrActiveCampaigns > 0, "business", `${input.acquisition.approvedOrActiveCampaigns} campaign approved/aktif.`),
        check("approved_batch", "Batch uji disetujui", input.acquisition.approvedBatches > 0, "evidence", `${input.acquisition.approvedBatches} batch menunggu processor.`),
        check("dry_run_evidence", "Dry-run terakhir berhasil", Boolean(acquisitionRun?.status === "succeeded" && acquisitionRun.dryRun), "evidence", acquisitionRun ? `Run terakhir: ${acquisitionRun.status}.` : "Belum ada audit run pada database."),
      ],
    }),
  ];

  const liveWorkflowCount = workflows.filter((item) => item.mode === "live").length;
  const validatedWorkflowCount = workflows.filter((item) => item.technicalStatus === "dry_run_validated").length;
  const uniqueBlockers = new Map<string, LaunchReadinessCheck>();
  workflows.flatMap((item) => item.blockers).forEach((item) => uniqueBlockers.set(item.key, item));

  return {
    generatedAt: new Date().toISOString(),
    overall: {
      state: liveWorkflowCount > 0 ? "live_guard_required" : validatedWorkflowCount === workflows.length ? "dry_run_validated" : "attention_required",
      activationLocked: true,
      humanApprovalRequired: true,
      liveWorkflowCount,
      validatedWorkflowCount,
      workflowCount: workflows.length,
      blockerCount: uniqueBlockers.size,
    },
    businessRules: {
      version: input.businessRules.version,
      status: input.businessRules.status,
      isMock: input.businessRules.isMock,
      outboundAutomationEnabled: input.businessRules.outboundAutomationEnabled,
      activationBlockers: input.businessRules.activationBlockers,
    },
    catalog: input.catalog,
    templates: input.templates,
    acquisition: input.acquisition,
    evidence: {
      emailDeliveryEventCount: input.evidence.emailDeliveryEventCount,
      eventQueueFailedCount: input.evidence.eventQueueFailedCount,
      calendarBookingCount: input.evidence.calendarBookingCount,
      calendarLineageIssueCount: input.evidence.calendarLineageIssueCount,
    },
    workflows,
  };
}
