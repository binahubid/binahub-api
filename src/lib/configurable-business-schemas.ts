import { z } from "zod";

const nullableEmail = z.string().trim().email().max(320).nullable().optional();
const nullableUserId = z.string().uuid().nullable().optional();
const nullableText = (maximum = 4000) => z.string().trim().max(maximum).nullable().optional();
const slugSchema = z.string().trim().min(2).max(80).regex(/^[a-z0-9][a-z0-9-]+$/);

const catalogProductInputSchema = z.object({
  id: z.string().uuid().optional(),
  productKey: z.string().trim().min(2).max(64).regex(/^[a-z0-9][a-z0-9_-]+$/),
  slug: slugSchema,
  name: z.string().trim().min(2).max(200),
  status: z.enum(["concept", "design", "development", "ready", "retired"]),
  objective: z.string().trim().max(2000).default(""),
  notes: z.string().trim().max(4000).default(""),
  shortDescription: z.string().trim().max(300).default(""),
  publicDescription: z.string().trim().max(8000).default(""),
  coverImageUrl: z.string().trim().url().max(2000).nullable().optional(),
  publicVisible: z.boolean().default(false),
  featured: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(10000).default(0),
}).strict().superRefine((value, context) => {
  if (value.publicVisible && value.status !== "ready") {
    context.addIssue({
      code: "custom",
      path: ["publicVisible"],
      message: "Produk publik harus berstatus ready.",
    });
  }
  if (value.publicVisible && value.shortDescription.length < 10) {
    context.addIssue({
      code: "custom",
      path: ["shortDescription"],
      message: "Ringkasan publik minimal 10 karakter.",
    });
  }
});

const catalogModuleInputSchema = z.object({
  id: z.string().uuid().optional(),
  productId: z.string().uuid(),
  moduleCode: z.string().trim().min(2).max(64).regex(/^[A-Z0-9][A-Z0-9_-]+$/),
  slug: slugSchema,
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).default(""),
  standardScope: z.string().trim().max(6000).default(""),
  deliverables: z.string().trim().max(6000).default(""),
  outOfScope: z.string().trim().max(6000).default(""),
  pricingUnit: z.string().trim().min(2).max(100),
  basePrice: z.number().min(0).max(999_999_999_999),
  minimumQuantity: z.number().positive().max(1_000_000).default(1),
  currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/).default("IDR"),
  durationLabel: z.string().trim().max(200).default(""),
  readinessStatus: z.enum(["research", "design", "development", "testing", "ready", "retired"]),
  isMock: z.boolean().default(false),
  active: z.boolean().default(true),
  publicVisible: z.boolean().default(false),
  featured: z.boolean().default(false),
  displayOrder: z.number().int().min(0).max(10000).default(0),
  catalogVersion: z.string().trim().min(2).max(100),
}).strict().superRefine((value, context) => {
  if (value.publicVisible && (!value.active || value.isMock || value.readinessStatus !== "ready")) {
    context.addIssue({
      code: "custom",
      path: ["publicVisible"],
      message: "Modul publik harus aktif, non-mock, dan berstatus ready.",
    });
  }
  if (value.publicVisible && (!value.description || !value.standardScope || !value.deliverables)) {
    context.addIssue({
      code: "custom",
      path: ["publicVisible"],
      message: "Modul publik membutuhkan deskripsi, scope, dan deliverable.",
    });
  }
});

export const catalogAdminMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_product"), product: catalogProductInputSchema }).strict(),
  z.object({ action: z.literal("save_module"), module: catalogModuleInputSchema }).strict(),
  z.object({
    action: z.literal("delete_product"),
    id: z.string().uuid(),
    confirmation: z.literal("DELETE"),
  }).strict(),
  z.object({
    action: z.literal("delete_module"),
    id: z.string().uuid(),
    confirmation: z.literal("DELETE"),
  }).strict(),
]);

export const businessSettingsMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_commercial_policy"),
    minimumTransactionEnabled: z.boolean(),
    minimumTransactionAmount: z.number().min(0).max(999_999_999_999),
    belowThresholdAction: z.enum(["allow", "reject", "approval_required", "route_to_module"]),
    routeCatalogModuleId: z.string().uuid().nullable().optional(),
    currency: z.string().trim().length(3).regex(/^[A-Z]{3}$/),
    proposalValidityDays: z.number().int().min(1).max(365),
    allowAdminOverride: z.boolean(),
    overrideRequiresNote: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.belowThresholdAction === "route_to_module" && !value.routeCatalogModuleId) {
      context.addIssue({
        code: "custom",
        path: ["routeCatalogModuleId"],
        message: "Pilih modul tujuan untuk kebijakan ini.",
      });
    }
  }),
  z.object({
    action: z.literal("save_governance_assignment"),
    functionKey: z.enum([
      "sales_operations",
      "proposal_commercial",
      "delivery",
      "deliverability_email",
      "template_content",
      "product_catalog",
      "technical_monitoring",
    ]),
    ownerUserId: nullableUserId,
    ownerEmail: nullableEmail,
    backupUserId: nullableUserId,
    backupEmail: nullableEmail,
    escalationChannel: nullableText(500),
    notes: nullableText(2000),
    active: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.active && !value.ownerEmail) {
      context.addIssue({ code: "custom", path: ["ownerEmail"], message: "Owner aktif wajib dipilih." });
    }
    if (value.ownerUserId && value.ownerUserId === value.backupUserId) {
      context.addIssue({ code: "custom", path: ["backupUserId"], message: "Backup harus berbeda dari owner." });
    }
  }),
  z.object({
    action: z.literal("save_approval_delegation"),
    approvalKey: z.enum([
      "standard_proposal",
      "discount_exception",
      "below_minimum_transaction",
      "custom_scope",
      "legal_reputation_risk",
      "strategic_or_high_value_deal",
    ]),
    primaryApproverUserId: nullableUserId,
    primaryApproverEmail: nullableEmail,
    delegateUserId: nullableUserId,
    delegateEmail: nullableEmail,
    validFrom: z.string().datetime({ offset: true }).nullable().optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    maximumAmount: z.number().min(0).max(999_999_999_999).nullable().optional(),
    maximumDiscountPercent: z.number().min(0).max(100).nullable().optional(),
    conditions: nullableText(4000),
    active: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.active && !value.primaryApproverEmail) {
      context.addIssue({ code: "custom", path: ["primaryApproverEmail"], message: "Approver utama wajib dipilih." });
    }
    if (value.delegateUserId && value.delegateUserId === value.primaryApproverUserId) {
      context.addIssue({ code: "custom", path: ["delegateUserId"], message: "Delegasi harus berbeda dari approver utama." });
    }
    if (value.validFrom && value.validUntil && value.validUntil <= value.validFrom) {
      context.addIssue({ code: "custom", path: ["validUntil"], message: "Masa delegasi tidak valid." });
    }
  }),
  z.object({
    action: z.literal("save_risk_sla"),
    severity: z.enum(["low", "medium", "high", "critical"]),
    enabled: z.boolean(),
    acknowledgmentMinutes: z.number().int().min(1).max(525600),
    initialReviewMinutes: z.number().int().min(1).max(525600),
    backupEscalationMinutes: z.number().int().min(1).max(525600),
    finalDecisionMinutes: z.number().int().min(1).max(525600),
    businessHoursOnly: z.boolean(),
    timeZone: z.string().trim().min(3).max(100),
    escalationChannels: z.array(z.enum(["notification", "email", "whatsapp", "phone"])).min(1).max(4),
    ownerEmail: nullableEmail,
    notes: nullableText(4000),
  }).strict().superRefine((value, context) => {
    if (
      value.initialReviewMinutes < value.acknowledgmentMinutes
      || value.backupEscalationMinutes < value.initialReviewMinutes
      || value.finalDecisionMinutes < value.backupEscalationMinutes
    ) {
      context.addIssue({
        code: "custom",
        path: ["finalDecisionMinutes"],
        message: "Urutan waktu SLA harus meningkat dari acknowledgment sampai keputusan akhir.",
      });
    }
    if (value.enabled && !value.ownerEmail) {
      context.addIssue({ code: "custom", path: ["ownerEmail"], message: "SLA aktif wajib memiliki owner." });
    }
  }),
  z.object({
    action: z.literal("save_document_template"),
    id: z.string().uuid().optional(),
    templateKey: z.string().trim().min(2).max(100).regex(/^[a-z][a-z0-9_-]+$/),
    documentType: z.enum(["proposal", "invoice"]),
    name: z.string().trim().min(2).max(200),
    locale: z.enum(["id", "en"]),
    version: z.string().trim().min(2).max(40),
    status: z.enum(["draft", "review", "approved", "archived"]),
    bodyTemplate: z.string().trim().min(10).max(30000),
    variables: z.array(z.string().trim().min(1).max(100)).max(30),
    reviewRequired: z.boolean(),
    ownerEmail: nullableEmail,
    approvalNote: nullableText(2000),
  }).strict().superRefine((value, context) => {
    if (value.status === "approved" && (!value.approvalNote || value.approvalNote.length < 5)) {
      context.addIssue({ code: "custom", path: ["approvalNote"], message: "Catatan approval minimal 5 karakter." });
    }
  }),
]);

export const questionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "yes_no",
  "scale",
  "short_text",
  "long_text",
  "number",
]);

const questionnaireQuestionFields = {
  position: z.number().int().min(1).max(1000),
  questionType: questionTypeSchema,
  prompt: z.string().trim().min(3).max(4000),
  helpText: z.string().trim().max(2000).default(""),
  required: z.boolean().default(true),
  options: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  correctAnswer: z.union([
    z.string().max(2000),
    z.number(),
    z.boolean(),
    z.array(z.string().max(500)).max(50),
  ]).nullable().optional(),
  points: z.number().min(0).max(10000).default(1),
  scaleMin: z.number().int().min(0).max(100).nullable().optional(),
  scaleMax: z.number().int().min(1).max(100).nullable().optional(),
  scaleLabels: z.record(z.string(), z.string().max(200)).default({}),
};

function validateQuestion(
  value: { questionType: z.infer<typeof questionTypeSchema>; options: string[]; scaleMin?: number | null; scaleMax?: number | null },
  context: z.RefinementCtx,
) {
  if (["single_choice", "multiple_choice"].includes(value.questionType) && value.options.length < 2) {
    context.addIssue({ code: "custom", path: ["options"], message: "Minimal dua pilihan jawaban." });
  }
  if (value.questionType === "scale" && (
    value.scaleMin === null
    || value.scaleMin === undefined
    || value.scaleMax === null
    || value.scaleMax === undefined
    || value.scaleMax <= value.scaleMin
  )) {
    context.addIssue({ code: "custom", path: ["scaleMax"], message: "Rentang skala tidak valid." });
  }
}

export const questionnaireQuestionInputSchema = z.object({
  id: z.string().uuid().optional(),
  ...questionnaireQuestionFields,
}).strict().superRefine(validateQuestion);

export const questionnaireQuestionImportSchema = z.object(questionnaireQuestionFields)
  .strict()
  .superRefine(validateQuestion);

export const programQuestionnaireMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save_questionnaire"),
    id: z.string().uuid().optional(),
    programId: z.string().uuid(),
    kind: z.enum(["pre_test", "post_test"]),
    title: z.string().trim().min(3).max(300),
    description: z.string().trim().max(4000).default(""),
    instructions: z.string().trim().max(4000).default(""),
    passingScore: z.number().min(0).max(100).nullable().optional(),
    allowRetake: z.boolean(),
    shuffleQuestions: z.boolean(),
  }).strict(),
  z.object({
    action: z.literal("save_question"),
    questionnaireId: z.string().uuid(),
    question: questionnaireQuestionInputSchema,
  }).strict(),
  z.object({
    action: z.literal("replace_questions"),
    questionnaireId: z.string().uuid(),
    sourceFilename: z.string().trim().max(300).nullable().optional(),
    sourceType: z.string().trim().max(100).nullable().optional(),
    questions: z.array(questionnaireQuestionImportSchema).min(1).max(200),
  }).strict(),
  z.object({
    action: z.literal("delete_question"),
    questionId: z.string().uuid(),
  }).strict(),
  z.object({
    action: z.literal("set_status"),
    questionnaireId: z.string().uuid(),
    status: z.enum(["draft", "published", "archived"]),
  }).strict(),
  z.object({
    action: z.literal("delete_questionnaire"),
    questionnaireId: z.string().uuid(),
    confirmation: z.literal("DELETE"),
  }).strict(),
]);

export const questionnaireSubmissionSchema = z.object({
  questionnaireId: z.string().uuid(),
  answers: z.array(z.object({
    questionId: z.string().uuid(),
    value: z.union([
      z.string().max(10000),
      z.number(),
      z.boolean(),
      z.array(z.string().max(1000)).max(100),
      z.null(),
    ]),
  }).strict()).min(1).max(300),
}).strict();
