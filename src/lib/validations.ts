import { z } from 'zod';

export const ASSESSMENT_QUESTION_IDS = Array.from({ length: 49 }, (_, index) => String(index + 1));
const assessmentQuestionIdSet = new Set(ASSESSMENT_QUESTION_IDS);

export const AssessmentAnswersSchema = z
  .record(z.string(), z.number().int().min(1).max(5))
  .superRefine((answers, context) => {
    const keys = Object.keys(answers);
    const missing = ASSESSMENT_QUESTION_IDS.filter((id) => !(id in answers));
    const unexpected = keys.filter((id) => !assessmentQuestionIdSet.has(id));

    if (missing.length > 0) {
      context.addIssue({
        code: 'custom',
        message: `Jawaban belum lengkap. Pertanyaan yang belum dijawab: ${missing.join(', ')}.`,
      });
    }

    if (unexpected.length > 0) {
      context.addIssue({
        code: 'custom',
        message: `ID pertanyaan tidak dikenal: ${unexpected.join(', ')}.`,
      });
    }
  });

export const AssessmentSchema = z.object({
  name: z.string().trim().min(1, 'Nama wajib diisi').max(200),
  email: z.string().trim().toLowerCase().email('Format email tidak valid').max(320),
  company: z.string().trim().min(1, 'Nama perusahaan wajib diisi').max(300),
  employees: z.string().trim().max(100).optional(),
  role: z.string().trim().max(200).optional(),
  whatsapp: z.string().trim().max(50).optional(),
  challenge: z.string().trim().max(4000).optional(),
  target: z.string().trim().max(4000).optional(),
  answers: AssessmentAnswersSchema,
  source: z.literal('insight_assessment').optional().default('insight_assessment'),
  locale: z.enum(['id', 'en']).optional().default('id'),
}).strict();

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
