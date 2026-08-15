import { z } from 'zod';

export const AssessmentSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(200),
  email: z.string().email('Format email tidak valid'),
  company: z.string().trim().min(1, 'Nama perusahaan wajib diisi').max(300),
  employees: z.string().max(100).optional(),
  role: z.string().max(200).optional(),
  whatsapp: z.string().max(50).optional(),
  challenge: z.string().max(4000).optional(),
  target: z.string().max(4000).optional(),
  answers: z.record(z.string().max(100), z.number().finite()).refine((answers) => Object.keys(answers).length <= 100),
  source: z.string().max(100).optional().default('insight_assessment'),
  locale: z.enum(['id', 'en']).optional().default('id'),
});

export type AssessmentData = z.infer<typeof AssessmentSchema>;

export const DIMENSIONS = ["Insights", "Lab", "Coach", "Play", "Academy", "Works", "Impact"] as const;

export const ChatRequestSchema = z.object({
  message: z.string().trim().min(1, 'Pesan tidak boleh kosong').max(4000),
  sessionId: z.string().uuid().optional().nullable(),
  sessionToken: z.string().min(32).max(128).optional().nullable(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(8000)
  })).max(30).optional(),
  context: z.object({
    currentPath: z.string().max(500).optional(),
    pageTitle: z.string().max(500).optional(),
    locale: z.enum(['id', 'en']).optional().default('id'),
  }).optional()
});

export type ChatRequestData = z.infer<typeof ChatRequestSchema>;
