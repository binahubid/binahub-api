import { z } from "zod";

export const uuidSchema = z.string().uuid();

export const engagementTypeSchema = z.enum(["assessment", "coaching", "training", "transformation"]);
export const engagementStatusSchema = z.enum(["draft", "active", "in_progress", "review", "completed", "archived"]);

export const evidenceTypeSchema = z.enum([
  "assessment",
  "reflection",
  "observation",
  "feedback",
  "coaching_note",
  "action_completion",
  "survey",
]);

export const evidenceSourceSchema = z.enum(["participant", "facilitator", "manager", "system"]);
export const actionStatusSchema = z.enum(["todo", "in_progress", "blocked", "done"]);

export const createEngagementSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  location: z.string().trim().max(200).optional(),
  code: z.string().trim().min(6, "Kode program minimal 6 karakter.").max(50),
  title: z.string().trim().min(1).max(200),
  type: engagementTypeSchema,
  status: engagementStatusSchema.optional().default("draft"),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  participantLimit: z.number().int().min(1).max(5000).optional().default(100),
}).refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
  message: "Tanggal selesai tidak boleh sebelum tanggal mulai.",
  path: ["endDate"],
});

export const updateEngagementStatusSchema = z.object({
  status: engagementStatusSchema,
});

export const createParticipantSchema = z.object({
  organizationId: uuidSchema,
  engagementId: uuidSchema.optional(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional(),
  roleTitle: z.string().trim().max(200).optional(),
  department: z.string().trim().max(200).optional(),
  engagementRole: z.enum(["participant", "leader", "observer"]).optional().default("participant"),
});

export const createEvidenceSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema.optional(),
  type: evidenceTypeSchema,
  source: evidenceSourceSchema,
  content: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 50_000, "Content terlalu besar.").default({}),
  capabilityTags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  confidenceScore: z.number().min(0).max(1).optional().default(0.5),
});

export const createActionSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  status: actionStatusSchema.optional().default("todo"),
  dueDate: z.string().date().optional(),
  progress: z.number().int().min(0).max(100).optional().default(0),
});

export const updateActionSchema = z.object({
  status: actionStatusSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(4000).optional(),
  dueDate: z.string().date().optional(),
}).refine((value) => Object.keys(value).length > 0, "Payload update tidak boleh kosong.");

export const generateInsightSchema = z.object({
  engagementId: uuidSchema,
  type: z.enum(["risk", "improvement", "recommendation"]).default("recommendation"),
});

export const submitReflectionSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema,
  prompt: z.string().trim().min(1).max(1000),
  situation: z.string().trim().min(10, "Ceritakan situasinya minimal 10 karakter.").max(10_000),
  learning: z.string().trim().min(10, "Tuliskan pembelajaran minimal 10 karakter.").max(10_000),
  nextAction: z.string().trim().min(5, "Tuliskan aksi berikutnya.").max(4000),
  capabilityTags: z.array(z.string().trim().min(1).max(100)).min(1, "Pilih minimal satu capability.").max(20),
  confidenceScore: z.number().min(0).max(1).optional().default(0.65),
});
