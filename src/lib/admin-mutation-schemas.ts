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
