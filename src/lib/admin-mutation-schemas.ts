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
