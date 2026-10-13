import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createPEInternalStore } from './store';
import { scorePEResponses as calculatePE } from './scoring';
import { readPEInstrument } from './definition';
import { makeSyntheticPEInstrument } from './synthetic-fixture';
const instrument=readPEInstrument(makeSyntheticPEInstrument());
const scorePEResponses=(input:unknown)=>calculatePE(input,instrument);

const id = randomUUID(); const participantRef = randomUUID(); const actorRef = randomUUID();
const now = new Date().toISOString();
const fixture = { id,instrumentId:'BINAINSIGHTS-PE-V1',instrumentVersion:'1.0.0-draft.1',mode:'internal_test',
  status:'draft',revision:0,responses:{},responseTimestamps:{},result:null,createdAt:now,updatedAt:now,
  submittedAt:null,retentionUntil:new Date(Date.now()+86_400_000).toISOString() };
function setup(data: unknown = fixture, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data,error });
  const store = createPEInternalStore({ rpc } as unknown as Pick<SupabaseClient,'rpc'>,{ participantRef,actorRef });
  return { store,rpc };
}
describe('trusted-server internal PE storage adapter', () => {
  it('binds actor and participant scope server-side on every call',async () => {
    const { store,rpc } = setup();
    expect(await store.start({ id,consentNoticeVersion:'test-notice-v1',privacyPolicyVersion:'test-policy-v1',
      consentedAt:now,retentionUntil:fixture.retentionUntil })).toEqual(fixture);
    await store.resume(id); await store.save({ id,expectedRevision:0,responses:{ SR01:'NA',SJ01:'A' } });
    const submitted = { ...fixture,status:'submitted',revision:1,responses:{ SJ01:'A' },
      responseTimestamps:{ SJ01:now },result:scorePEResponses({ SJ01:'A' }),submittedAt:now };
    rpc.mockResolvedValueOnce({ data:submitted,error:null });
    expect(await store.submit({ id,expectedRevision:0,responses:{ SJ01:'A' },submissionKey:'submission_key_0001' })).toEqual(submitted);
    rpc.mockResolvedValueOnce({ data:true,error:null }); expect(await store.erase(id)).toBe(true);
    for (const [,args] of rpc.mock.calls) expect(args).toMatchObject({ p_participant_ref:participantRef,p_actor_ref:actorRef });
    expect(rpc.mock.calls.map(c => c[0])).toEqual(['pe_start_internal_attempt','pe_get_internal_attempt',
      'pe_write_internal_attempt','pe_write_internal_attempt','pe_delete_internal_attempt']);
    expect(rpc.mock.calls[2][1]).toMatchObject({ p_expected_revision:0,p_responses:{SR01:'NA',SJ01:'A'},p_submission_key:null });
    expect(rpc.mock.calls[3][1]).toMatchObject({ p_submission_key:'submission_key_0001' });
    expect(JSON.stringify(rpc.mock.calls)).not.toMatch(/scoring_key|option_scores|rationales/);
  });
  it('rejects malformed IDs, responses, revision and extra request fields before a DB call',async () => {
    const { store,rpc } = setup();
    await expect(store.resume('not-uuid')).rejects.toThrow();
    await expect(store.save({ id,expectedRevision:-1,responses:{} })).rejects.toThrow();
    await expect(store.save({ id,expectedRevision:0,responses:{ SJ01:'NA' } })).rejects.toThrow();
    await expect(store.submit({ id,expectedRevision:0,responses:{},submissionKey:'short' })).rejects.toThrow();
    await expect(store.save({ id,expectedRevision:0,responses:{},result:100 } as never)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('returns only allowlisted error codes, never database or transport diagnostics',async () => {
    const { store,rpc } = setup(null,{message:'PE_REVISION_CONFLICT detail: private data'});
    await expect(store.resume(id)).rejects.toThrow(/^PE_REVISION_CONFLICT$/);
    rpc.mockResolvedValueOnce({data:null,error:{message:'PE_UNEXPECTED_SECRET private data'}});
    await expect(store.resume(id)).rejects.toThrow(/^PE_STORAGE_UNAVAILABLE$/);
    rpc.mockRejectedValueOnce(new Error('transport secret details'));
    await expect(store.resume(id)).rejects.toThrow(/^PE_STORAGE_UNAVAILABLE$/);
  });
  it.each([null,{}, {...fixture,scoring_key:'B'}, {...fixture,result:{ overall:80 }},
    {...fixture,mode:'production'}, {...fixture,responses:{SR01:null}}])('fails closed for an unexpected storage contract (%j)',async data => {
      const { store } = setup(data);
      await expect(store.resume(id)).rejects.toThrow(/^PE_STORAGE_(CONTRACT_MISMATCH|UNAVAILABLE)$/);
    });
  it('rejects unconfirmed erasure results',async () => {
    const { store } = setup(false);
    await expect(store.erase(id)).rejects.toThrow('PE_STORAGE_CONTRACT_MISMATCH');
  });
});
