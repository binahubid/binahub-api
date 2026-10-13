import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PEResponsesSchema,PEAttemptSchema,type PEAttempt } from './contracts';

const uuid = z.uuid();
const version = z.string().trim().min(1).max(120);
const scopeSchema = z.object({ participantRef: uuid, actorRef: uuid }).strict();
const startSchema = z.object({
  id: uuid, consentNoticeVersion: version, privacyPolicyVersion: version,
  consentedAt: z.iso.datetime({ offset: true }), retentionUntil: z.iso.datetime({ offset: true }),
}).strict();
const writeSchema = z.object({
  id: uuid, expectedRevision: z.number().int().nonnegative(), responses: PEResponsesSchema,
}).strict();
const submissionKeySchema = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/);

export class PEStoreError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'PEStoreError';
  }
}

/**
 * INTERNAL TEST ONLY. Never expose this as a public route or browser Supabase client.
 * A trusted server caller must authorize the actor and bind participantRef itself.
 * Browser-supplied actor/participant IDs are NOT authorization.
 * Production delivery/participant authentication is deliberately a later phase.
 */
export function createPEInternalStore(client: Pick<SupabaseClient, 'rpc'>, scope: z.infer<typeof scopeSchema>) {
  const { participantRef, actorRef } = scopeSchema.parse(scope);
  const ownership = { p_participant_ref: participantRef, p_actor_ref: actorRef };
  async function call(name: string, args: Record<string, unknown>): Promise<unknown> {
    try {
      const { data, error } = await client.rpc(name, { ...ownership, ...args });
      if (error) {
        // Do not return database diagnostics, answer values, or private instrument content.
        const code = /\bPE_[A-Z_]+\b/.exec(error.message || '')?.[0];
        const allowed = new Set(['PE_INSTRUMENT_SETUP_REQUIRED','PE_ATTEMPT_NOT_FOUND','PE_START_CONFLICT','PE_INTERNAL_TEST_METADATA_REQUIRED',
          'PE_REVISION_CONFLICT','PE_ATTEMPT_FINALIZED','PE_INVALID_SUBMISSION_KEY','PE_INVALID_RESPONSE','PE_INVALID_RESPONSES']);
        throw new PEStoreError(code && allowed.has(code) ? code : 'PE_STORAGE_UNAVAILABLE');
      }
      if (data === null) throw new PEStoreError('PE_STORAGE_UNAVAILABLE');
      return data;
    } catch (error) {
      if (error instanceof PEStoreError) throw error;
      throw new PEStoreError('PE_STORAGE_UNAVAILABLE');
    }
  }
  async function attemptCall(name: string, args: Record<string, unknown>): Promise<PEAttempt> {
    const data = PEAttemptSchema.safeParse(await call(name,args));
    if (!data.success) throw new PEStoreError('PE_STORAGE_CONTRACT_MISMATCH');
    return data.data;
  }
  return {
    async start(input: z.infer<typeof startSchema>) {
      const value = startSchema.parse(input);
      return attemptCall('pe_start_internal_attempt', {
        p_id: value.id, p_consent_notice_version: value.consentNoticeVersion,
        p_privacy_policy_version: value.privacyPolicyVersion,
        p_consented_at: value.consentedAt, p_retention_until: value.retentionUntil,
      });
    },
    async resume(id: string) { return attemptCall('pe_get_internal_attempt', { p_id: uuid.parse(id) }); },
    async save(input: z.infer<typeof writeSchema>) {
      const value = writeSchema.parse(input);
      return attemptCall('pe_write_internal_attempt', { p_id: value.id, p_expected_revision: value.expectedRevision,
        p_responses: value.responses, p_submission_key: null });
    },
    async submit(input: z.infer<typeof writeSchema> & { submissionKey: string }) {
      const { submissionKey, ...rest } = input;
      const value = writeSchema.parse(rest);
      return attemptCall('pe_write_internal_attempt', { p_id: value.id, p_expected_revision: value.expectedRevision,
        p_responses: value.responses, p_submission_key: submissionKeySchema.parse(submissionKey) });
    },
    async erase(id: string) {
      if (await call('pe_delete_internal_attempt', { p_id: uuid.parse(id) }) !== true) {
        throw new PEStoreError('PE_STORAGE_CONTRACT_MISMATCH');
      }
      return true;
    },
  };
}
