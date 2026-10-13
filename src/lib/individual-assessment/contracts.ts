import { z } from 'zod';

export const PEResponsesSchema = z.record(z.string(),z.union([
  z.number().int().min(1).max(5),z.enum(['NA','A','B','C','D']),
])).superRefine((answers,ctx)=>{
  for (const [id,value] of Object.entries(answers)) {
    const valid = /^SR(0[1-9]|1[0-9]|2[0-4])$/.test(id) ? typeof value==='number' || value==='NA'
      : /^SJ(0[1-9]|1[0-2])$/.test(id) && typeof value==='string' && ['A','B','C','D'].includes(value);
    if (!valid) ctx.addIssue({code:'custom',path:[id],message:'Item atau pilihan jawaban tidak sesuai instrumen.'});
  }
});
export type PEResponses = z.infer<typeof PEResponsesSchema>;

const count = z.number().int().nonnegative();
const score = z.number().min(0).max(100).nullable();
export const PEResultSchema = z.object({
  instrumentId: z.literal('BINAINSIGHTS-PE-V1'), instrumentVersion: z.string(),
  scoringVersion: z.literal('pe-dual-method-v1'), reportRulesVersion: z.string(),
  priorityRulesVersion: z.literal('awaiting_ceo'), validationStatus: z.literal('DRAFT_FOR_EXPERT_REVIEW_AND_PILOT'),
  completeness: z.object({ expectedCount: z.literal(36), answeredCount: count, missingCount: count,
    naCount: count, scoredMethods: count }).strict(),
  competencies: z.array(z.object({
    code: z.string().regex(/^PE-0[1-6]$/),
    selfReport: z.object({ status:z.enum(['scored','insufficient_evidence']),validCount:count,
      naCount:count,missingCount:count,expectedCount:z.literal(4),rawSum:count,
      mean:z.number().min(1).max(5).nullable(),score }).strict(),
    sjt: z.object({ status:z.enum(['scored','incomplete']),validCount:count,missingCount:count,
      expectedCount:z.literal(2),rawSum:count,maximum:count,score }).strict(),
  }).strict()).length(6),
}).strict();

// Raw draft responses are returned only to the authorized internal caller, not a public results DTO.
export const PEAttemptSchema = z.object({
  id:z.uuid(),instrumentId:z.literal('BINAINSIGHTS-PE-V1'),instrumentVersion:z.string(),
  mode:z.literal('internal_test'),status:z.enum(['draft','submitted']),revision:count,
  responses:PEResponsesSchema,
  responseTimestamps:z.record(z.string(),z.iso.datetime({ offset:true })),
  result:PEResultSchema.nullable(),createdAt:z.iso.datetime({ offset:true }),
  updatedAt:z.iso.datetime({ offset:true }),submittedAt:z.iso.datetime({ offset:true }).nullable(),
  retentionUntil:z.iso.datetime({ offset:true }),
}).strict();
export type PEAttempt = z.infer<typeof PEAttemptSchema>;
