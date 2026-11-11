import { z } from "zod";
import { MeetingWriteSchema } from "@/lib/spin/meeting";

const version = z.number().int().nonnegative();
const note = z.string().trim().max(4000);
export const consultantQuery = z.object({
  page: z.coerce.number().int().min(0).max(10000).default(0),
  search: z.string().trim().max(150).default(""),
  owner: z
    .union([z.enum(["all", "mine", "unassigned"]), z.uuid()])
    .default("all"),
  view: z.enum(["all", "active", "won", "lost", "handoff"]).default("all"),
});
export const consultantAction = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("meeting"),
      version,
      ...MeetingWriteSchema.omit({ revision: true }).shape,
    })
    .strict(),
  z
    .object({ action: z.literal("source"), version, sourceId: z.uuid() })
    .strict(),
  z
    .object({
      action: z.literal("task"),
      version,
      id: z.uuid(),
      title: z.string().trim().min(1).max(240),
      dueAt: z.iso.datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete_task"),
      version,
      taskId: z.uuid(),
      revision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({ action: z.literal("activity"), version, note: note.min(1) })
    .strict(),
  z
    .object({
      action: z.literal("stage"),
      version,
      stage: z.enum([
        "identified",
        "qualified",
        "consultation",
        "proposal",
        "negotiation",
        "won",
        "lost",
      ]),
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel_message"),
      version,
      messageId: z.uuid(),
    })
    .strict(),
  z
    .object({ action: z.literal("handoff"), version, note: note.min(1) })
    .strict(),
  z
    .object({ action: z.literal("replacement"), version, note: note.min(1) })
    .strict(),
]);
export const consultantManagement = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("member"),
      userId: z.uuid(),
      name: z.string().trim().min(1).max(200),
      active: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal("assign"),
      leadId: z.uuid(),
      userId: z.uuid(),
      version,
      note,
    })
    .strict(),
  z
    .object({
      action: z.literal("booking"),
      leadId: z.uuid(),
      bookingId: z.uuid(),
    })
    .strict(),
]);
export const proposalInput = z
  .object({
    version,
    programCodes: z
      .array(z.string().regex(/^SS-\d{2}$/))
      .min(1)
    .max(31)
      .refine((v) => new Set(v).size === v.length),
    days: z.number().int().positive().max(365),
    participants: z.number().int().positive().max(100000),
    venue: z.enum(["indoor", "outdoor", "hybrid", "online"]),
    location: z.string().trim().max(300),
    scopeNote: note,
  })
  .strict();
export const messageInput = z
  .object({
    id: z.uuid(),
    version,
    kind: z.enum(["proposal", "follow_up"]),
    proposalId: z.uuid().nullable(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .refine((s) => !/[\r\n]/.test(s)),
    body: z.string().trim().min(1).max(10000),
    scheduledAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine((v) => v.kind !== "proposal" || v.proposalId !== null);

export type ConsultantLead = {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  stage: string;
  nextAction: string | null;
  nextActionDueAt: string | null;
  assigneeId: string | null;
  assigneeName: string;
  version: number;
  assignmentRevision: number;
  canEdit: boolean;
  checklistStatus: string;
  handoff: object | null;
  updatedAt: string;
};
export type ConsultantWorkspace = {
  lead_id: string;
  assignee_id: string | null;
  assignment_revision: number;
  version: number;
  checklist_revision: number;
  source_id: string | null;
  original_answers: Record<string, string | number | string[]>;
  answers: Record<string, string | number | string[]>;
  notes: string;
  checklist_status: "in_progress" | "completed";
  updated_at: string;
};
export type ConsultantDetail = {
  record: ConsultantLead;
  workspace: ConsultantWorkspace | null;
  proposals: Array<{
    id: string;
    lead_id: string;
    revision: number;
    snapshot: unknown;
    status: string;
    created_at: string;
  }>;
};
