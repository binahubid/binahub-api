import { z } from "zod";

export const contactStatusSchema = z.enum([
  "Lead Baru",
  "Follow Up",
  "Qualified",
  "Client",
  "Lanjut Diskusi",
  "Selesai",
  "Archived",
]);

export const inquiryStatusSchema = z.enum([
  "Baru",
  "Dibalas",
  "Perlu Follow Up",
  "Follow Up 1 Terkirim",
  "Follow Up 2 Terkirim",
  "Follow Up 3 Terkirim",
  "Lanjut Diskusi",
  "Qualified",
  "Client",
  "Selesai",
  "Diarsipkan",
]);

export const assessmentStatusSchema = z.enum([
  "Belum Dikirim",
  "Analisis Gagal",
  "Result Otomatis Terkirim",
  "Result Email Terkirim",
  "Minta Proposal",
  "Proposal Terkirim",
  "Follow Up",
  "Result Follow Up 1 Terkirim",
  "Result Follow Up 2 Terkirim",
  "Result Follow Up 3 Terkirim",
  "Lanjut Diskusi",
  "Closed",
]);

export const proposalStatusSchema = z.enum([
  "Belum Diminta",
  "Diminta",
  "Sedang Disusun",
  "Draft Simulasi",
  "Menunggu Approval",
  "Disetujui",
  "Terkirim",
  "Proposal Follow Up 1 Terkirim",
  "Proposal Follow Up 2 Terkirim",
  "Proposal Follow Up 3 Terkirim",
  "Revisi",
  "Lanjut Diskusi",
  "Deal",
  "Lost",
  "Closed",
]);

const notesSchema = z.string().max(4000, "Catatan maksimal 4.000 karakter.");

export const contactUpdateSchema = z.object({
  id: z.string().uuid("ID kontak tidak valid."),
  status: contactStatusSchema,
  notes: notesSchema,
}).strict();

export const inquiryUpdateSchema = z.object({
  id: z.string().uuid("ID inquiry tidak valid."),
  status: inquiryStatusSchema,
  notes: notesSchema,
  followUpPaused: z.boolean().optional(),
}).strict();

export const assessmentStatusUpdateSchema = z.object({
  id: z.string().uuid("ID assessment tidak valid."),
  assessmentStatus: assessmentStatusSchema,
  proposalStatus: proposalStatusSchema,
  followUpPaused: z.boolean().optional(),
}).strict();

export const assessmentActionSchema = z.object({
  id: z.string().uuid("ID assessment tidak valid."),
  action: z.enum(["resend_result", "request_proposal", "send_proposal"]),
}).strict();

export const proposalDraftSchema = z.object({
  assessmentId: z.string().uuid("ID assessment tidak valid."),
  moduleItems: z.array(z.object({
    catalogModuleId: z.string().uuid("ID modul katalog tidak valid."),
    quantity: z.number().int().min(1).max(1000),
  }).strict()).min(1, "Pilih minimal satu modul.").max(20),
  scopeType: z.enum(["standard", "custom"]),
  discountPercent: z.number().min(0).max(100).default(0),
  aiConfidence: z.number().min(0).max(1).optional(),
  riskFlags: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
  notes: z.string().trim().max(4000).default(""),
  proposalContext: z.object({
    organizationName: z.string().trim().max(300).optional(),
    problemOrNeed: z.string().trim().max(4000).optional(),
    objective: z.string().trim().max(4000).optional(),
    participantEstimate: z.string().trim().max(500).optional(),
    targetAudience: z.string().trim().max(1000).optional(),
    scope: z.string().trim().max(6000).optional(),
    timeline: z.string().trim().max(1000).optional(),
    decisionMakerOrSponsor: z.string().trim().max(500).optional(),
    budgetIndication: z.string().trim().max(500).optional(),
    deliveryLocationOrMode: z.string().trim().max(1000).optional(),
    expectedOutcome: z.string().trim().max(4000).optional(),
    nextStep: z.string().trim().max(2000).optional(),
  }).strict().default({}),
}).strict();

export const proposalApprovalSchema = z.object({
  assessmentId: z.string().uuid("ID assessment tidak valid."),
  decision: z.enum(["approve", "reject", "request_revision"]),
  note: z.string().trim().max(4000).default(""),
}).strict();

export const opportunityStageSchema = z.enum([
  "identified",
  "qualified",
  "consultation",
  "proposal",
  "negotiation",
  "won",
  "lost",
]);

export const salesOpportunityUpdateSchema = z.object({
  leadId: z.string().uuid("ID lead tidak valid."),
  stage: opportunityStageSchema,
  owner: z.string().trim().email("Email owner tidak valid.").max(320).nullable().optional(),
  nextAction: z.string().trim().max(2000).nullable().optional(),
  nextActionDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  lostReason: z.string().trim().max(2000).nullable().optional(),
  opportunityValue: z.number().min(0).max(999_999_999_999).nullable().optional(),
  leadTimeZone: z.string().trim().min(3).max(80).nullable().optional(),
  outreachPaused: z.boolean().nullable().optional(),
  outreachPauseReason: z.string().trim().max(1000).nullable().optional(),
}).strict().superRefine((value, context) => {
  const activeStages = ["qualified", "consultation", "proposal", "negotiation"];
  if (value.stage !== "identified" && !value.owner) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Owner wajib ditetapkan sebelum peluang diproses atau ditutup." });
  }
  if (activeStages.includes(value.stage) && !value.nextAction) {
    context.addIssue({ code: "custom", path: ["nextAction"], message: "Next action wajib untuk peluang aktif." });
  }
  if (activeStages.includes(value.stage) && !value.nextActionDueAt) {
    context.addIssue({ code: "custom", path: ["nextActionDueAt"], message: "Tenggat next action wajib untuk peluang aktif." });
  }
  if (value.stage === "lost" && (!value.lostReason || value.lostReason.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["lostReason"],
      message: "Alasan lost minimal 5 karakter.",
    });
  }
  if (!["won", "lost"].includes(value.stage) && value.nextActionDueAt && !value.nextAction) {
    context.addIssue({
      code: "custom",
      path: ["nextAction"],
      message: "Next action wajib diisi ketika due date ditetapkan.",
    });
  }
});

const adminOwnerSchema = z.string().trim().email("Email owner tidak valid.").max(320);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus memakai format YYYY-MM-DD.");

export const clientHandoffSchema = z.object({
  leadId: z.string().uuid("ID lead tidak valid."),
  commercialOwner: adminOwnerSchema,
  deliveryOwner: adminOwnerSchema,
  projectTitle: z.string().trim().min(3, "Nama project minimal 3 karakter.").max(300),
  kickoffDate: isoDateSchema.nullable().optional(),
}).strict();

export const clientAccountUpdateSchema = z.object({
  clientAccountId: z.string().uuid("ID client account tidak valid."),
  status: z.enum(["onboarding", "active", "at_risk", "inactive", "churned"]),
  commercialOwner: adminOwnerSchema,
  deliveryOwner: adminOwnerSchema,
  nextReviewAt: isoDateSchema.nullable().optional(),
  renewalDate: isoDateSchema.nullable().optional(),
  retainStatus: z.enum(["monitoring", "opportunity", "renewal_due", "expanded", "churned"]),
  notes: z.string().trim().max(4000).nullable().optional(),
  changeReason: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["at_risk", "inactive", "churned"].includes(value.status) && (!value.changeReason || value.changeReason.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["changeReason"],
      message: "Alasan perubahan minimal 5 karakter untuk status berisiko, inactive, atau churned.",
    });
  }
});

export const clientStakeholderSchema = z.object({
  id: z.string().uuid("ID stakeholder tidak valid.").nullable().optional(),
  clientAccountId: z.string().uuid("ID client account tidak valid."),
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email("Email stakeholder tidak valid.").max(320).or(z.literal("")).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  roleTitle: z.string().trim().max(200).nullable().optional(),
  department: z.string().trim().max(200).nullable().optional(),
  relationshipRole: z.enum(["sponsor", "decision_maker", "champion", "pic", "buyer", "user", "blocker", "other"]),
  isPrimary: z.boolean().default(false),
  active: z.boolean().default(true),
  notes: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.isPrimary && !value.active) {
    context.addIssue({ code: "custom", path: ["active"], message: "Stakeholder utama harus aktif." });
  }
});

export const deliveryProjectUpdateSchema = z.object({
  projectId: z.string().uuid("ID project tidak valid."),
  deliveryStage: z.enum(["handoff", "kickoff", "planning", "in_progress", "at_risk", "on_hold", "completed", "cancelled"]),
  deliveryOwner: adminOwnerSchema.nullable().optional(),
  startDate: isoDateSchema.nullable().optional(),
  endDate: isoDateSchema.nullable().optional(),
  deliveryGoal: z.string().trim().max(4000).nullable().optional(),
  successMetrics: z.array(z.string().trim().min(2).max(500)).max(20).default([]),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  riskSummary: z.string().trim().max(4000).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (!["completed", "cancelled"].includes(value.deliveryStage) && !value.deliveryOwner) {
    context.addIssue({ code: "custom", path: ["deliveryOwner"], message: "Delivery owner wajib ditetapkan." });
  }
  if ((value.deliveryStage === "at_risk" || ["high", "critical"].includes(value.riskLevel))
    && (!value.riskSummary || value.riskSummary.length < 5)) {
    context.addIssue({ code: "custom", path: ["riskSummary"], message: "Ringkasan risiko minimal 5 karakter." });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    context.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai." });
  }
});

export const deliveryMilestoneSchema = z.object({
  id: z.string().uuid("ID milestone tidak valid.").nullable().optional(),
  projectId: z.string().uuid("ID project tidak valid."),
  title: z.string().trim().min(2).max(300),
  description: z.string().trim().max(4000).nullable().optional(),
  owner: adminOwnerSchema,
  dueDate: isoDateSchema.nullable().optional(),
  status: z.enum(["planned", "in_progress", "blocked", "completed", "cancelled"]),
  progress: z.number().int().min(0).max(100),
  weight: z.number().min(0).max(100).default(0),
  blockerReason: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "blocked" && (!value.blockerReason || value.blockerReason.length < 5)) {
    context.addIssue({ code: "custom", path: ["blockerReason"], message: "Alasan blocker minimal 5 karakter." });
  }
});

export const accountHealthReviewSchema = z.object({
  clientAccountId: z.string().uuid("ID client account tidak valid."),
  projectId: z.string().uuid("ID project tidak valid.").nullable().optional(),
  deliveryScore: z.number().int().min(1).max(5),
  engagementScore: z.number().int().min(1).max(5),
  sentimentScore: z.number().int().min(1).max(5),
  commercialScore: z.number().int().min(1).max(5),
  riskLevel: z.enum(["healthy", "watch", "at_risk", "critical"]),
  riskReasons: z.array(z.string().trim().min(2).max(300)).max(20).default([]),
  notes: z.string().trim().max(4000).nullable().optional(),
  nextAction: z.string().trim().max(2000).nullable().optional(),
  nextActionDueAt: isoDateSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["at_risk", "critical"].includes(value.riskLevel)) {
    if (!value.nextAction) context.addIssue({ code: "custom", path: ["nextAction"], message: "Next action wajib untuk account berisiko." });
    if (!value.nextActionDueAt) context.addIssue({ code: "custom", path: ["nextActionDueAt"], message: "Tenggat next action wajib untuk account berisiko." });
  }
});

export const retentionOpportunitySchema = z.object({
  id: z.string().uuid("ID retention opportunity tidak valid.").nullable().optional(),
  clientAccountId: z.string().uuid("ID client account tidak valid."),
  sourceProjectId: z.string().uuid("ID project tidak valid.").nullable().optional(),
  opportunityType: z.enum(["renewal", "upsell", "cross_sell", "repeat", "referral"]),
  status: z.enum(["identified", "qualified", "proposal", "won", "lost", "on_hold"]),
  owner: adminOwnerSchema,
  moduleRequestData: z.record(z.string(), z.unknown()).default({}),
  estimatedValue: z.number().min(0).max(999_999_999_999).nullable().optional(),
  expectedCloseDate: isoDateSchema.nullable().optional(),
  nextAction: z.string().trim().max(2000).nullable().optional(),
  nextActionDueAt: z.string().datetime({ offset: true }).nullable().optional(),
  lostReason: z.string().trim().max(2000).nullable().optional(),
  humanApproved: z.boolean().default(false),
  approvalNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["qualified", "proposal"].includes(value.status)) {
    if (!value.nextAction) context.addIssue({ code: "custom", path: ["nextAction"], message: "Next action wajib untuk retention opportunity aktif." });
    if (!value.nextActionDueAt) context.addIssue({ code: "custom", path: ["nextActionDueAt"], message: "Tenggat next action wajib untuk retention opportunity aktif." });
  }
  if (value.status === "lost" && (!value.lostReason || value.lostReason.length < 5)) {
    context.addIssue({ code: "custom", path: ["lostReason"], message: "Alasan lost minimal 5 karakter." });
  }
  if (["proposal", "won"].includes(value.status)
    && (!value.humanApproved || !value.approvalNote || value.approvalNote.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["approvalNote"],
      message: "Proposal/won retention membutuhkan approval manusia dan catatan minimal 5 karakter.",
    });
  }
});

export const operationalTaskUpdateSchema = z.object({
  taskId: z.string().uuid("ID operational task tidak valid."),
  status: z.enum(["open", "in_progress", "waiting", "completed", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  assignedTo: adminOwnerSchema.nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  resolutionNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["in_progress", "waiting"].includes(value.status) && !value.assignedTo) {
    context.addIssue({
      code: "custom",
      path: ["assignedTo"],
      message: "Owner wajib ditetapkan untuk task aktif atau menunggu.",
    });
  }
  if (["completed", "cancelled"].includes(value.status)
    && (!value.resolutionNote || value.resolutionNote.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["resolutionNote"],
      message: "Catatan penyelesaian minimal 5 karakter.",
    });
  }
});

export const uatScenarioUpdateSchema = z.object({
  scenarioId: z.string().uuid("ID skenario UAT tidak valid."),
  status: z.enum(["not_started", "in_progress", "passed", "failed", "blocked", "not_applicable"]),
  owner: adminOwnerSchema.nullable().optional(),
  environment: z.enum(["local", "staging", "production"]),
  evidenceNote: z.string().trim().max(4000).nullable().optional(),
  evidenceUrl: z.string().trim().url("URL bukti tidak valid.").max(2000)
    .refine((value) => value.startsWith("https://"), "URL bukti harus memakai HTTPS.")
    .nullable().optional(),
  actualResult: z.string().trim().max(4000).nullable().optional(),
  blockerReason: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["in_progress", "passed", "failed", "blocked"].includes(value.status) && !value.owner) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Owner wajib untuk pengujian aktif." });
  }
  if (["passed", "failed"].includes(value.status)) {
    if (!value.evidenceNote || value.evidenceNote.length < 5) {
      context.addIssue({ code: "custom", path: ["evidenceNote"], message: "Catatan bukti minimal 5 karakter." });
    }
    if (!value.actualResult || value.actualResult.length < 5) {
      context.addIssue({ code: "custom", path: ["actualResult"], message: "Hasil aktual minimal 5 karakter." });
    }
  }
  if (value.status === "blocked" && (!value.blockerReason || value.blockerReason.length < 5)) {
    context.addIssue({ code: "custom", path: ["blockerReason"], message: "Alasan blocker minimal 5 karakter." });
  }
});

export const acquisitionSourceSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  sourceKey: z.string().trim().min(3).max(64).regex(/^[a-z][a-z0-9_-]{2,63}$/),
  name: z.string().trim().min(2).max(200),
  providerType: z.enum(["manual_upload", "website", "google_ads", "meta_ads", "microsoft_ads", "apollo", "linkedin", "google_maps", "referral", "partner", "other"]),
  channel: z.enum(["inbound", "outbound", "partner", "offline"]),
  acquisitionMethod: z.string().trim().min(3).max(500),
  lawfulBasis: z.enum(["consent", "legitimate_interest", "contract", "legal_obligation", "public_task", "not_applicable"]).nullable().optional(),
  privacyNoticeUrl: z.string().url().max(2000).nullable().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  dataOwner: adminOwnerSchema.nullable().optional(),
  legalOwner: adminOwnerSchema.nullable().optional(),
  status: z.enum(["draft", "approved", "paused", "rejected"]),
  active: z.boolean().default(false),
  config: z.record(z.string(), z.unknown()).default({}),
  humanApproved: z.boolean().default(false),
  approvalNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.active && value.status !== "approved") {
    context.addIssue({ code: "custom", path: ["active"], message: "Hanya source approved yang dapat diaktifkan." });
  }
  if (value.status === "approved") {
    if (!value.humanApproved) context.addIssue({ code: "custom", path: ["humanApproved"], message: "Persetujuan manusia wajib." });
    if (!value.lawfulBasis) context.addIssue({ code: "custom", path: ["lawfulBasis"], message: "Lawful basis wajib." });
    if (!value.retentionDays) context.addIssue({ code: "custom", path: ["retentionDays"], message: "Retention period wajib." });
    if (!value.dataOwner) context.addIssue({ code: "custom", path: ["dataOwner"], message: "Data owner wajib." });
    if (!value.legalOwner) context.addIssue({ code: "custom", path: ["legalOwner"], message: "Legal owner wajib." });
    if (!value.approvalNote || value.approvalNote.length < 5) context.addIssue({ code: "custom", path: ["approvalNote"], message: "Catatan approval minimal 5 karakter." });
    if (value.channel === "outbound" && !value.privacyNoticeUrl) context.addIssue({ code: "custom", path: ["privacyNoticeUrl"], message: "Privacy notice wajib untuk source outbound." });
  }
});

export const acquisitionCampaignSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  sourceId: z.string().uuid("Source acquisition tidak valid."),
  campaignCode: z.string().trim().min(3).max(64).regex(/^[A-Z0-9][A-Z0-9_-]{2,63}$/),
  name: z.string().trim().min(2).max(200),
  objective: z.enum(["awareness", "traffic", "assessment", "consultation", "lead_generation"]),
  channel: z.enum(["email", "google_ads", "meta_ads", "microsoft_ads", "linkedin", "referral", "organic", "other"]),
  status: z.enum(["draft", "approved", "active", "paused", "completed", "cancelled"]),
  owner: adminOwnerSchema,
  budgetAmount: z.number().min(0).max(999_999_999_999).nullable().optional(),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).default("IDR"),
  startsOn: isoDateSchema.nullable().optional(),
  endsOn: isoDateSchema.nullable().optional(),
  utmConfig: z.record(z.string(), z.unknown()).default({}),
  targetDefinition: z.record(z.string(), z.unknown()).default({}),
  humanApproved: z.boolean().default(false),
  approvalNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["approved", "active"].includes(value.status)
    && (!value.humanApproved || !value.approvalNote || value.approvalNote.length < 5)) {
    context.addIssue({ code: "custom", path: ["approvalNote"], message: "Campaign approved/active membutuhkan human approval dan catatan." });
  }
  if (value.status === "active" && (!value.startsOn || !value.endsOn)) {
    context.addIssue({ code: "custom", path: ["startsOn"], message: "Campaign aktif membutuhkan tanggal mulai dan selesai." });
  }
  if (value.startsOn && value.endsOn && value.endsOn < value.startsOn) {
    context.addIssue({ code: "custom", path: ["endsOn"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai." });
  }
});

const acquisitionProspectSchema = z.object({
  externalId: z.string().trim().max(300).nullable().optional(),
  name: z.string().trim().max(300).default(""),
  email: z.string().trim().max(320).default(""),
  company: z.string().trim().max(300).nullable().optional(),
  phone: z.string().trim().max(80).nullable().optional(),
  roleTitle: z.string().trim().max(200).nullable().optional(),
  industry: z.string().trim().max(200).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  employeeRange: z.string().trim().max(100).nullable().optional(),
  websiteUrl: z.string().url().max(2000).nullable().optional(),
  linkedinUrl: z.string().url().max(2000).nullable().optional(),
  sourceUrl: z.string().url().max(2000).nullable().optional(),
  consentStatus: z.enum(["unknown", "opted_in", "not_required", "opted_out"]).default("unknown"),
}).strict();

export const acquisitionBatchSchema = z.object({
  sourceId: z.string().uuid("Source acquisition tidak valid."),
  campaignId: z.string().uuid().nullable().optional(),
  importKey: z.string().trim().min(8).max(200),
  fileName: z.string().trim().max(300).nullable().optional(),
  fileChecksum: z.string().trim().max(256).nullable().optional(),
  prospects: z.array(acquisitionProspectSchema).min(1).max(500),
}).strict();

export const acquisitionBatchReviewSchema = z.object({
  batchId: z.string().uuid("Batch acquisition tidak valid."),
  decision: z.enum(["approved", "rejected"]),
  note: z.string().trim().min(5).max(2000),
}).strict();

export const outreachTemplateKeySchema = z.enum([
  "inquiry_follow_up_1",
  "inquiry_follow_up_2",
  "inquiry_follow_up_3",
  "assessment_result_follow_up_1",
  "assessment_result_follow_up_2",
  "assessment_result_follow_up_3",
  "assessment_proposal_follow_up_1",
  "assessment_proposal_follow_up_2",
  "assessment_proposal_follow_up_3",
]);

export const outreachTemplateMutationSchema = z.object({
  id: z.string().uuid().optional(),
  templateKey: outreachTemplateKeySchema,
  locale: z.enum(["id", "en"]).default("id"),
  version: z.string().trim().min(1).max(40),
  status: z.enum(["draft", "approved", "archived"]),
  subjectTemplate: z.string().trim().min(1).max(300),
  htmlTemplate: z.string().trim().min(10).max(30000),
  owner: z.string().trim().email("Email owner template tidak valid.").max(320).nullable().optional(),
  isMock: z.boolean().default(false),
  approvalNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "approved" && value.isMock) {
    context.addIssue({ code: "custom", path: ["isMock"], message: "Template mock tidak dapat disetujui." });
  }
  if (value.status === "approved" && (!value.approvalNote || value.approvalNote.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["approvalNote"],
      message: "Catatan approval minimal 5 karakter.",
    });
  }
});

export const catalogModuleMutationSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid("Produk tidak valid."),
  moduleCode: z.string().trim().min(2).max(64).regex(/^[A-Z0-9][A-Z0-9_-]+$/),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(""),
  standardScope: z.string().trim().max(4000).default(""),
  pricingUnit: z.string().trim().min(2).max(100),
  basePrice: z.number().min(0).max(999_999_999_999),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).default("IDR"),
  readinessStatus: z.enum(["research", "design", "development", "testing", "ready", "retired"]),
  isMock: z.boolean(),
  active: z.boolean(),
  catalogVersion: z.string().trim().min(2).max(100),
}).strict();

const pilotOwnerSchema = z.string().trim().email("Email owner pilot tidak valid.").max(320);
const optionalPilotOwnerSchema = pilotOwnerSchema.nullable().optional();
const pilotDateTimeSchema = z.string().datetime({ offset: true }).nullable().optional();
const pilotChecklistSchema = z.array(z.string().trim().min(5).max(500)).max(30);

export const pilotReleasePlanSchema = z.object({
  action: z.literal("save_plan"),
  releaseId: z.string().uuid("ID release pilot tidak valid.").nullable().optional(),
  releaseKey: z.string().trim().min(3).max(80).regex(
    /^[a-z][a-z0-9_-]{2,79}$/,
    "Release key harus diawali huruf kecil dan hanya memakai huruf kecil, angka, underscore, atau dash.",
  ),
  title: z.string().trim().min(3).max(200),
  cohortDescription: z.string().trim().min(10).max(4000),
  maximumParticipants: z.number().int().min(1).max(10000),
  startsAt: pilotDateTimeSchema,
  endsAt: pilotDateTimeSchema,
  businessOwner: optionalPilotOwnerSchema,
  technicalOwner: optionalPilotOwnerSchema,
  monitoringOwner: optionalPilotOwnerSchema,
  successCriteria: pilotChecklistSchema.default([]),
  rollbackTriggers: pilotChecklistSchema.default([]),
  rollbackPlan: z.string().trim().max(4000).nullable().optional(),
  isMock: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && new Date(value.endsAt) <= new Date(value.startsAt)) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Waktu selesai harus setelah waktu mulai." });
  }
});

export const pilotReleaseTransitionSchema = z.object({
  action: z.literal("transition_plan"),
  releaseId: z.string().uuid("ID release pilot tidak valid."),
  nextStatus: z.enum(["review_requested", "approved", "rejected", "scheduled", "paused", "rolled_back", "completed"]),
  decisionNote: z.string().trim().min(10).max(4000),
}).strict();

export const automationRuntimeControlSchema = z.object({
  action: z.literal("set_control"),
  workflowKey: z.enum([
    "follow_up_scheduler",
    "transformation_event_worker",
    "client_operations_daily",
    "acquisition_batch_processor",
  ]),
  requestedMode: z.enum(["disabled", "dry_run", "pilot", "live"]),
  maximumItemsPerRun: z.number().int().min(1).max(500),
  owner: optionalPilotOwnerSchema,
  releaseId: z.string().uuid("ID release pilot tidak valid.").nullable().optional(),
  humanApproved: z.boolean().default(false),
  approvalNote: z.string().trim().max(4000).nullable().optional(),
  rollbackPlan: z.string().trim().max(4000).nullable().optional(),
  killSwitchReason: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.requestedMode === "disabled"
    && (!value.killSwitchReason || value.killSwitchReason.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["killSwitchReason"],
      message: "Alasan kill switch minimal 5 karakter.",
    });
  }
  if (["pilot", "live"].includes(value.requestedMode)) {
    if (!value.humanApproved) {
      context.addIssue({ code: "custom", path: ["humanApproved"], message: "Persetujuan manusia wajib." });
    }
    if (!value.owner) {
      context.addIssue({ code: "custom", path: ["owner"], message: "Owner workflow wajib ditetapkan." });
    }
    if (!value.releaseId) {
      context.addIssue({ code: "custom", path: ["releaseId"], message: "Release pilot approved wajib dipilih." });
    }
    if (!value.approvalNote || value.approvalNote.length < 10) {
      context.addIssue({ code: "custom", path: ["approvalNote"], message: "Catatan persetujuan minimal 10 karakter." });
    }
    if (!value.rollbackPlan || value.rollbackPlan.length < 10) {
      context.addIssue({ code: "custom", path: ["rollbackPlan"], message: "Rencana rollback minimal 10 karakter." });
    }
  }
});

export const pilotOperationsMutationSchema = z.discriminatedUnion("action", [
  pilotReleasePlanSchema,
  pilotReleaseTransitionSchema,
  automationRuntimeControlSchema,
]);

const assuredWorkflowSchema = z.enum([
  "follow_up_scheduler",
  "transformation_event_worker",
  "client_operations_daily",
  "acquisition_batch_processor",
]);

export const monitoringPolicyMutationSchema = z.object({
  action: z.literal("save_policy"),
  workflowKey: assuredWorkflowSchema,
  lookbackHours: z.number().int().min(1).max(168),
  minimumRuns: z.number().int().min(1).max(1000),
  maximumFailureRatePercent: z.number().min(0).max(100),
  staleRunningMinutes: z.number().int().min(5).max(1440),
  maximumConsecutiveFailures: z.number().int().min(1).max(20),
  enabled: z.boolean(),
  owner: pilotOwnerSchema.nullable().optional(),
  isMock: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.isMock && !value.owner) {
    context.addIssue({
      code: "custom",
      path: ["owner"],
      message: "Policy real wajib memiliki owner.",
    });
  }
});

export const operationalScanMutationSchema = z.object({
  action: z.literal("run_scan"),
  releaseId: z.string().uuid("ID release pilot tidak valid.").nullable().optional(),
  materializeIncidents: z.boolean().default(false),
  humanApproved: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.materializeIncidents && !value.humanApproved) {
    context.addIssue({
      code: "custom",
      path: ["humanApproved"],
      message: "Konfirmasi manusia wajib untuk mencatat finding sebagai incident.",
    });
  }
});

export const automationIncidentMutationSchema = z.object({
  action: z.literal("update_incident"),
  incidentId: z.string().uuid("ID incident tidak valid."),
  status: z.enum(["open", "investigating", "monitoring", "resolved", "dismissed"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  owner: pilotOwnerSchema.nullable().optional(),
  resolutionNote: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (["investigating", "monitoring", "resolved", "dismissed"].includes(value.status) && !value.owner) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Owner incident wajib ditetapkan." });
  }
  if (["resolved", "dismissed"].includes(value.status)
    && (!value.resolutionNote || value.resolutionNote.length < 10)) {
    context.addIssue({
      code: "custom",
      path: ["resolutionNote"],
      message: "Catatan penyelesaian minimal 10 karakter.",
    });
  }
});

export const pilotGoNoGoMutationSchema = z.object({
  action: z.literal("record_review"),
  releaseId: z.string().uuid("ID release pilot tidak valid."),
  snapshotId: z.string().uuid("ID snapshot monitoring tidak valid."),
  decision: z.enum(["go", "conditional_go", "no_go"]),
  conditions: z.array(z.string().trim().min(5).max(500)).max(30).default([]),
  decisionNote: z.string().trim().min(10).max(4000),
}).strict().superRefine((value, context) => {
  if (value.decision === "conditional_go" && value.conditions.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["conditions"],
      message: "Conditional go wajib memiliki minimal satu kondisi.",
    });
  }
});

export const operationalAssuranceMutationSchema = z.discriminatedUnion("action", [
  monitoringPolicyMutationSchema,
  operationalScanMutationSchema,
  automationIncidentMutationSchema,
  pilotGoNoGoMutationSchema,
]);

export const pilotRehearsalPlanSchema = z.object({
  action: z.literal("save_rehearsal"),
  rehearsalId: z.string().uuid("ID rehearsal tidak valid.").nullable().optional(),
  releaseId: z.string().uuid("ID release pilot tidak valid."),
  rehearsalKey: z.string().trim().min(3).max(80).regex(
    /^[a-z][a-z0-9_-]{2,79}$/,
    "Rehearsal key harus memakai huruf kecil, angka, underscore, atau dash.",
  ),
  title: z.string().trim().min(5).max(200),
  environment: z.enum(["local", "staging", "production"]),
  owner: pilotOwnerSchema.nullable().optional(),
  approver: pilotOwnerSchema.nullable().optional(),
  isMock: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (!value.isMock && (!value.owner || !value.approver)) {
    context.addIssue({
      code: "custom",
      path: ["owner"],
      message: "Rehearsal real wajib memiliki owner dan approver.",
    });
  }
});

export const pilotRehearsalStepSchema = z.object({
  action: z.literal("update_step"),
  stepId: z.string().uuid("ID langkah rehearsal tidak valid."),
  status: z.enum(["pending", "running", "passed", "failed", "blocked"]),
  owner: pilotOwnerSchema.nullable().optional(),
  evidenceNote: z.string().trim().max(4000).nullable().optional(),
  evidenceUrl: z.string().trim().url("URL bukti tidak valid.").max(2000).nullable().optional(),
  actualResult: z.string().trim().max(4000).nullable().optional(),
  blockerReason: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.status !== "pending" && !value.owner) {
    context.addIssue({ code: "custom", path: ["owner"], message: "Owner langkah wajib ditetapkan." });
  }
  if (["passed", "failed"].includes(value.status)
    && ((!value.evidenceNote || value.evidenceNote.length < 5)
      || (!value.actualResult || value.actualResult.length < 5))) {
    context.addIssue({
      code: "custom",
      path: ["evidenceNote"],
      message: "Catatan bukti dan hasil aktual minimal 5 karakter.",
    });
  }
  if (value.status === "blocked" && (!value.blockerReason || value.blockerReason.length < 5)) {
    context.addIssue({
      code: "custom",
      path: ["blockerReason"],
      message: "Alasan blocker minimal 5 karakter.",
    });
  }
});

export const pilotRehearsalTransitionSchema = z.object({
  action: z.literal("transition_rehearsal"),
  rehearsalId: z.string().uuid("ID rehearsal tidak valid."),
  nextStatus: z.enum(["in_progress", "passed", "failed", "aborted"]),
  snapshotId: z.string().uuid("ID snapshot monitoring tidak valid.").nullable().optional(),
  summary: z.string().trim().max(4000).nullable().optional(),
  rollbackResult: z.string().trim().max(4000).nullable().optional(),
  failureReason: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.nextStatus === "passed") {
    if (!value.snapshotId) context.addIssue({ code: "custom", path: ["snapshotId"], message: "Snapshot monitoring wajib dipilih." });
    if (!value.summary || value.summary.length < 10) context.addIssue({ code: "custom", path: ["summary"], message: "Ringkasan minimal 10 karakter." });
    if (!value.rollbackResult || value.rollbackResult.length < 10) context.addIssue({ code: "custom", path: ["rollbackResult"], message: "Hasil rollback drill minimal 10 karakter." });
  }
  if (["failed", "aborted"].includes(value.nextStatus)
    && (!value.failureReason || value.failureReason.length < 10)) {
    context.addIssue({ code: "custom", path: ["failureReason"], message: "Alasan kegagalan minimal 10 karakter." });
  }
});

export const pilotAcceptanceCertificationSchema = z.object({
  action: z.literal("record_certification"),
  releaseId: z.string().uuid("ID release pilot tidak valid."),
  rehearsalId: z.string().uuid("ID rehearsal tidak valid."),
  snapshotId: z.string().uuid("ID snapshot monitoring tidak valid."),
  decision: z.enum(["accepted", "accepted_with_conditions", "rejected"]),
  conditions: z.array(z.string().trim().min(5).max(500)).max(30).default([]),
  decisionNote: z.string().trim().min(10).max(4000),
  isMock: z.boolean().default(true),
}).strict().superRefine((value, context) => {
  if (value.decision === "accepted_with_conditions" && value.conditions.length === 0) {
    context.addIssue({ code: "custom", path: ["conditions"], message: "Penerimaan bersyarat wajib memiliki kondisi." });
  }
  if (["accepted", "accepted_with_conditions"].includes(value.decision) && value.isMock) {
    context.addIssue({ code: "custom", path: ["isMock"], message: "Penerimaan hanya dapat memakai evidence real." });
  }
});

export const pilotCertificationMutationSchema = z.discriminatedUnion("action", [
  pilotRehearsalPlanSchema,
  pilotRehearsalStepSchema,
  pilotRehearsalTransitionSchema,
  pilotAcceptanceCertificationSchema,
]);
