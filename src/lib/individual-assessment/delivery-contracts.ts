import { z } from 'zod';
import { PEResponsesSchema,PEResultSchema } from './contracts';

export const PE_FREE_CODES=['PE-02','PE-04','PE-06'] as const;
export const PE_POLICY_ID='pe-free3-2026-10-13-v1';
export const PE_CONSENT_VERSION='pe-development-consent-v1';
export const PE_PRIVACY_VERSION='pe-personal-privacy-v1';
export const PEContextSchema=z.object({role:z.string().trim().min(1).max(100),goal:z.string().trim().min(1).max(600),
  relevance:z.object({'PE-02':z.enum(['low','normal','high']),'PE-04':z.enum(['low','normal','high']),
    'PE-06':z.enum(['low','normal','high'])}).strict()}).strict();
export const PEStartSchema=z.object({id:z.uuid(),context:PEContextSchema,
  consentVersion:z.literal(PE_CONSENT_VERSION),privacyVersion:z.literal(PE_PRIVACY_VERSION)}).strict();
export const PEWriteSchema=z.object({revision:z.number().int().nonnegative(),responses:PEResponsesSchema,
  submissionKey:z.string().regex(/^[A-Za-z0-9_-]{16,128}$/).optional()}).strict();
export const PEDeliveryResultSchema=z.object({instrumentId:z.literal('BINAINSIGHTS-PE-V1'),instrumentVersion:z.string(),
  scoringVersion:z.literal('pe-dual-method-v1'),policyId:z.literal(PE_POLICY_ID),reportVersion:z.literal('pe-web-development-v1'),
  releaseStatus:z.literal('development_pilot'),contentReview:z.literal('ceo_reviewed'),priorityVersion:z.literal('pe-relevance-evidence-v1'),
  completeness:z.object({expectedCount:z.literal(18),answeredCount:z.number().int().min(0).max(18),naCount:z.number().int().min(0).max(12)}).strict(),
  competencies:PEResultSchema.shape.competencies.element.array().length(3).refine(rows=>rows.map(r=>r.code).join()===PE_FREE_CODES.join()),
}).strict();
export const PEDeliveryAttemptSchema=z.object({id:z.uuid(),policyId:z.literal(PE_POLICY_ID),status:z.enum(['draft','submitted']),
  revision:z.number().int().nonnegative(),context:PEContextSchema,responses:PEResponsesSchema,result:PEDeliveryResultSchema.nullable(),
  createdAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),submittedAt:z.iso.datetime({offset:true}).nullable(),
  retentionUntil:z.iso.datetime({offset:true})}).strict();
export type PEDeliveryAttempt=z.infer<typeof PEDeliveryAttemptSchema>;
export type PEContext=z.infer<typeof PEContextSchema>;
