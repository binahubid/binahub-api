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
  organizationId: uuidSchema,
  code: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1),
  type: engagementTypeSchema,
  status: engagementStatusSchema.optional().default("draft"),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
});

export const updateEngagementStatusSchema = z.object({
  status: engagementStatusSchema,
});

export const createParticipantSchema = z.object({
  organizationId: uuidSchema,
  engagementId: uuidSchema.optional(),
  name: z.string().trim().min(1),
  email: z.string().trim().email().optional(),
  roleTitle: z.string().trim().optional(),
  department: z.string().trim().optional(),
  engagementRole: z.enum(["participant", "leader", "observer"]).optional().default("participant"),
});

export const createEvidenceSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema.optional(),
  type: evidenceTypeSchema,
  source: evidenceSourceSchema,
  content: z.record(z.string(), z.unknown()).default({}),
  capabilityTags: z.array(z.string().trim().min(1)).default([]),
  confidenceScore: z.number().min(0).max(1).optional().default(0.5),
});

export const createActionSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema.optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().optional(),
  status: actionStatusSchema.optional().default("todo"),
  dueDate: z.string().trim().optional(),
  progress: z.number().int().min(0).max(100).optional().default(0),
});

export const updateActionSchema = z.object({
  status: actionStatusSchema.optional(),
  progress: z.number().int().min(0).max(100).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().optional(),
  dueDate: z.string().trim().optional(),
}).refine((value) => Object.keys(value).length > 0, "Payload update tidak boleh kosong.");

export const generateInsightSchema = z.object({
  engagementId: uuidSchema,
  type: z.enum(["risk", "improvement", "recommendation"]).default("recommendation"),
});

export const submitReflectionSchema = z.object({
  engagementId: uuidSchema,
  participantId: uuidSchema,
  prompt: z.string().trim().min(1),
  situation: z.string().trim().min(10, "Ceritakan situasinya minimal 10 karakter."),
  learning: z.string().trim().min(10, "Tuliskan pembelajaran minimal 10 karakter."),
  nextAction: z.string().trim().min(5, "Tuliskan aksi berikutnya."),
  capabilityTags: z.array(z.string().trim().min(1)).min(1, "Pilih minimal satu capability."),
  confidenceScore: z.number().min(0).max(1).optional().default(0.65),
});
