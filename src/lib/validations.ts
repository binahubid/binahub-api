import { z } from 'zod';

export const AssessmentSchema = z.object({
  name: z.string().min(1, 'Nama wajib diisi'),
  email: z.string().email('Format email tidak valid'),
  company: z.string().min(1, 'Nama perusahaan wajib diisi'),
  employees: z.string().optional(),
  role: z.string().optional(),
  whatsapp: z.string().optional(),
  challenge: z.string().optional(),
  target: z.string().optional(),
  answers: z.record(z.string(), z.number()), // qId as string, score as number
  source: z.string().optional().default('insight_assessment'),
  locale: z.enum(['id', 'en']).optional().default('id'),
});

export type AssessmentData = z.infer<typeof AssessmentSchema>;

export const DIMENSIONS = ["Insights", "Lab", "Coach", "Play", "Academy", "Works", "Impact"] as const;

export const ChatRequestSchema = z.object({
  message: z.string().min(1, 'Pesan tidak boleh kosong'),
  sessionId: z.string().optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  }).passthrough()).optional().default([]),
  context: z.object({
    currentPath: z.string().optional(),
    pageTitle: z.string().optional(),
    locale: z.enum(['id', 'en']).optional().default('id'),
  }).passthrough().optional()
});

export type ChatRequestData = z.infer<typeof ChatRequestSchema>;
