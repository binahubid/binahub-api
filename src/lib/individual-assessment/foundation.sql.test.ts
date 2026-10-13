import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import catalog from '@/data/competency-catalog-2026.json';
import { readPEInstrument, hashPEInstrument } from './definition';
import { scorePEResponses as calculatePE, type PEResponses } from './scoring';

import { makeSyntheticPEInstrument } from './synthetic-fixture';
const privatePEBundle=readPEInstrument(makeSyntheticPEInstrument());
const PE_BUNDLE_SHA256=hashPEInstrument(privatePEBundle);
const scorePEResponses=(input:unknown)=>calculatePE(input,privatePEBundle);
const register=()=>db.query('select pe_register_draft_instrument_v1($1::jsonb,$2)',[JSON.stringify(privatePEBundle),PE_BUNDLE_SHA256]);
const sql = readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql','utf8');
const sql63 = readFileSync('supabase/migrations/0063_competency_dictionary.sql','utf8');
const db = new PGlite();
const actor = randomUUID(); const participant = randomUUID();
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,
      is_mock boolean default false,catalog_version text default 'signature-2026-ceo-v1',
      base_price numeric default 25000000,metadata jsonb default '{}');`);
  for (const s of catalog.solutions) await db.query('insert into catalog_modules(module_code) values($1)',[s.moduleCode]);
  await db.exec(sql63); await db.exec(sql); await register();
},30_000);
afterAll(async () => { await db.close(); });

async function start(id = randomUUID()) {
  const consentedAt = new Date(Date.now()-60_000).toISOString();
  const retentionUntil = new Date(Date.now()+86_400_000).toISOString();
  const args = [id,participant,actor,'internal-test-notice-v1','internal-test-privacy-v1',consentedAt,retentionUntil];
  const response = await db.query<{ value: Record<string, unknown> }>(
    'select pe_start_internal_attempt($1,$2,$3,$4,$5,$6,$7) as value',args);
  return { id,args,attempt:response.rows[0].value };
}
async function write(id: string, revision: number, responses: unknown, key: string | null = null, owner = participant, operator = actor) {
  return (await db.query<{ value: Record<string, unknown> }>(
    'select pe_write_internal_attempt($1,$2,$3,$4,$5::jsonb,$6) as value',
    [id,owner,operator,revision,JSON.stringify(responses),key])).rows[0].value;
}
async function score(responses: unknown) {
  return (await db.query<{ value: unknown }>(
    'select pe_score_responses(manifest,$1::jsonb) as value from pe_instrument_versions',
    [JSON.stringify(responses)])).rows[0].value;
}

describe('SQL 64 versioned private foundation', () => {
  it('seeds exact source snapshots, hashes, and six proposed mappings without changing the 26-code catalog',async () => {
    expect(sql).not.toContain('private seed content');
    expect((await db.query('select bundle_sha256,manifest,release_status,public_enabled from pe_instrument_versions')).rows)
      .toEqual([{ bundle_sha256:PE_BUNDLE_SHA256,manifest:privatePEBundle,release_status:'draft',public_enabled:false }]);
    expect((await db.query('select pe_code,catalog_code,status from pe_catalog_crosswalks order by pe_code')).rows)
      .toEqual(privatePEBundle.catalog_crosswalks.map(m => ({ pe_code:m.pe_code,catalog_code:m.catalog_code,status:'proposed' })));
    expect((await db.query('select code,name from competency_dictionary order by code')).rows).toEqual(catalog.competencies);
    expect((await db.query("select * from competency_dictionary where content_status <> 'awaiting_ceo'")).rows).toHaveLength(0);
    expect((await db.query('select count(*)::int as count from catalog_module_competencies')).rows).toEqual([{ count:189 }]);
  });
  it('blocks instrument changes, silent public activation, and unsupported crosswalk approval',async () => {
    await expect(db.exec("update pe_instrument_versions set manifest='{}'")).rejects.toThrow('PE_VERSION_IMMUTABLE');
    await expect(db.exec('update pe_instrument_versions set public_enabled=true')).rejects.toThrow();
    await expect(db.exec('delete from pe_instrument_versions')).rejects.toThrow('PE_VERSION_IMMUTABLE');
    await expect(db.exec("update pe_catalog_crosswalks set status='approved'")).rejects.toThrow();
    await expect(db.exec("update pe_catalog_crosswalks set catalog_code='COMP-999'")).rejects.toThrow();
  });
  it('denies browser roles all access including private answer keys and RPC invocation',async () => {
    const functions = ['pe_start_internal_attempt(uuid,uuid,uuid,text,text,timestamptz,timestamptz)',
      'pe_get_internal_attempt(uuid,uuid,uuid)','pe_write_internal_attempt(uuid,uuid,uuid,int,jsonb,text)',
      'pe_delete_internal_attempt(uuid,uuid,uuid)','pe_register_draft_instrument_v1(jsonb,text)','pe_score_responses(jsonb,jsonb)','pe_attempt_dto(pe_attempts)'];
    for (const table of ['pe_instrument_versions','pe_catalog_crosswalks','pe_attempts','pe_audit_events']) {
      expect((await db.query('select relrowsecurity from pg_class where relname=$1',[table])).rows).toEqual([{ relrowsecurity:true }]);
      for (const role of ['anon','authenticated']) {
        expect((await db.query(`select has_table_privilege('${role}',$1,'select,insert,update,delete') as allowed`,[table])).rows).toEqual([{ allowed:false }]);
      }
      expect((await db.query("select has_table_privilege('service_role',$1,'insert,update,delete') as allowed",[table])).rows).toEqual([{ allowed:false }]);
    }
    for (const fn of functions) for (const role of ['anon','authenticated']) {
      expect((await db.query(`select has_function_privilege('${role}',$1,'execute') as allowed`,[fn])).rows).toEqual([{ allowed:false }]);
    }
    await db.exec('set role authenticated');
    try {
      await expect(db.exec('select manifest from pe_instrument_versions')).rejects.toThrow('permission denied');
      await expect(db.exec("select pe_score_responses('{}','{}')")).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  });
  it('lets the trusted service role use guarded RPCs, not overwrite rows directly',async () => {
    await db.exec('set role service_role');
    try {
      const { id } = await start();
      const result = await write(id,0,{ SR01:4,SJ01:'B' });
      expect(result.revision).toBe(1);
      await expect(db.exec("update pe_attempts set responses='{}'")).rejects.toThrow('permission denied');
    } finally { await db.exec('reset role'); }
  });
  it('reapplies without changing attempts or erasing a later reviewed mapping',async () => {
    const { id } = await start(); await write(id,0,{ SR01:'NA' });
    await db.query("update pe_catalog_crosswalks set status='approved',reviewed_by=$1,reviewed_at=now(),review_reference='test review only' where pe_code='PE-01'",[actor]);
    await db.exec(sql); await register();
    expect((await db.query('select revision,responses from pe_attempts where id=$1',[id])).rows).toEqual([{ revision:1,responses:{ SR01:'NA' } }]);
    expect((await db.query("select status from pe_catalog_crosswalks where pe_code='PE-01'")).rows).toEqual([{ status:'approved' }]);
  });
  it('rejects a changed seed with the same version rather than overwriting history',async () => {
    const changed=makeSyntheticPEInstrument(); changed.config.assessment.purpose='Changed synthetic purpose';
    await expect(db.query('select pe_register_draft_instrument_v1($1::jsonb,$2)',[JSON.stringify(changed),hashPEInstrument(changed)])).rejects.toThrow('PE_SOURCE_CONFLICT');
    expect((await db.query('select manifest from pe_instrument_versions')).rows).toEqual([{ manifest:privatePEBundle }]);
  });
  it('rejects malformed source registration before writing an instrument or mapping',async()=>{
    const changes:Array<(b:ReturnType<typeof makeSyntheticPEInstrument>)=>void>=[
      b=>{b.metadata.public_enabled=true as never;},b=>{b.config.sjt_items[0].scoring_key='B';},
      b=>{b.config.self_report_items[0].key_action_code='KA06.4';},b=>{b.config.sjt_items[0].key_action_codes=['KA01.1'];},
      b=>{b.config.sjt_items[0].option_scores.A=9;},b=>{b.config.sjt_items[0].options[0].id='B';},
      b=>{b.config.self_report_items.pop();},b=>{b.key_actions[0].code='KA06.4';},
      b=>{b.config.scoring.sjt.minimum_valid_scenarios_per_competency=1 as never;},
    ];
    for(const change of changes) {
      const input=makeSyntheticPEInstrument();input.metadata.instrument_version='invalid-test-version';change(input);
      await expect(db.query('select pe_register_draft_instrument_v1($1::jsonb,$2)',[JSON.stringify(input),hashPEInstrument(input)])).rejects.toThrow('PE_INSTRUMENT_STRUCTURE_INVALID');
    }
    expect((await db.query('select count(*)::int as count from pe_instrument_versions')).rows).toEqual([{count:1}]);
  });
  it('does not partially install the schema when SQL 63 is missing',async()=>{
    const empty=new PGlite();
    try {
      await empty.exec('create role anon;create role authenticated;create role service_role bypassrls;');
      await expect(empty.exec(sql)).rejects.toThrow('PE_CATALOG_PREREQUISITE');
      await empty.exec('rollback');
      expect((await empty.query("select to_regclass('public.pe_attempts') as relation")).rows).toEqual([{relation:null}]);
    }finally{await empty.close();}
  },30_000);
});

describe('durable draft, atomic submission, and data lifecycle', () => {
  it('creates once, resumes the exact saved draft, and preserves item timestamps',async () => {
    const { id,args,attempt } = await start();
    expect((await db.query('select pe_start_internal_attempt($1,$2,$3,$4,$5,$6,$7) as value',args)).rows).toEqual([{ value:attempt }]);
    const saved = await write(id,0,{ SR01:3,SJ01:'A' });
    const resumed = (await db.query<{ value:unknown }>('select pe_get_internal_attempt($1,$2,$3) as value',[id,participant,actor])).rows[0].value;
    expect(resumed).toEqual(saved);
    const savedAgain = await write(id,1,{ SR01:3,SR02:'NA' });
    expect(savedAgain.responseTimestamps).toMatchObject({ SR01:(saved.responseTimestamps as Record<string,unknown>).SR01 });
    expect(Object.keys(savedAgain.responseTimestamps as object)).toEqual(['SR01','SR02']);
    expect(savedAgain.responses).toEqual({ SR01:3,SR02:'NA' });
    expect(savedAgain.result).toBeNull();
    expect((await db.query("select count(*)::int as count from pe_audit_events where attempt_id=$1 and event='internal_attempt_created'",[id])).rows).toEqual([{ count:1 }]);
  });
  it('rejects stale concurrent writes instead of silently losing answers',async () => {
    const { id } = await start();
    const updates = await Promise.allSettled([write(id,0,{ SR01:2 }),write(id,0,{ SR02:3 })]);
    expect(updates.filter(r => r.status==='fulfilled')).toHaveLength(1);
    expect(updates.filter(r => r.status==='rejected')).toHaveLength(1);
    const failure = updates.find(r => r.status==='rejected') as PromiseRejectedResult;
    expect(failure.reason.message).toContain('PE_REVISION_CONFLICT');
  });
  it('stores answers and scoring once, returns an identical replay, and freezes final answers',async () => {
    const { id } = await start();
    const responses = { SR01:4,SR02:4,SR03:5,SR04:'NA',SJ01:'B',SJ02:'B' };
    const result = await write(id,0,responses,'test_submission_0001');
    expect(result.status).toBe('submitted');
    expect(result.result).toEqual(scorePEResponses(responses));
    expect(await write(id,0,responses,'test_submission_0001')).toEqual(result);
    await expect(write(id,1,{ ...responses,SR01:5 },'test_submission_0001')).rejects.toThrow('PE_ATTEMPT_FINALIZED');
    await expect(write(id,1,responses,'test_submission_0002')).rejects.toThrow('PE_ATTEMPT_FINALIZED');
    await expect(write(id,1,responses)).rejects.toThrow('PE_ATTEMPT_FINALIZED');
    expect((await db.query("select count(*)::int as count from pe_audit_events where attempt_id=$1 and event='submitted'",[id])).rows).toEqual([{ count:1 }]);
    expect(JSON.stringify(result)).not.toMatch(/scoring_key|option_scores|rationales/);
  });
  it('returns incomplete method results for a partial submission without making a missing-answer policy decision',async () => {
    const { id } = await start();
    const result = await write(id,0,{ SJ01:'B' },'partial_submission_01');
    expect(result.result).toEqual(scorePEResponses({ SJ01:'B' }));
  });
  it('rejects wrong participant and actor references without revealing the attempt',async () => {
    const { id } = await start();
    for (const [owner,operator] of [[randomUUID(),actor],[participant,randomUUID()]]) {
      await expect(write(id,0,{},null,owner,operator)).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
      await expect(db.query('select pe_get_internal_attempt($1,$2,$3)',[id,owner,operator])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
      await expect(db.query('select pe_delete_internal_attempt($1,$2,$3)',[id,owner,operator])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    }
  });
  it('rolls back failed validation without altering the draft or audit log',async () => {
    const { id } = await start();
    for (const bad of [null,[],{ SR01:null },{ SR01:0 },{ SR01:1.5 },{ SR01:'A' },{ SJ01:'NA' },{SJ01:3},{SR99:5},{ '1':4 }]) {
      await expect(write(id,0,bad,'invalid_submission01')).rejects.toThrow('PE_INVALID_RESPONSE');
    }
    await expect(write(id,0,{},'short')).rejects.toThrow('PE_INVALID_SUBMISSION_KEY');
    expect((await db.query('select revision,responses,status,result from pe_attempts where id=$1',[id])).rows)
      .toEqual([{ revision:0,responses:{},status:'draft',result:null }]);
    expect((await db.query('select count(*)::int as count from pe_audit_events where attempt_id=$1',[id])).rows).toEqual([{ count:1 }]);
  });
  it('requires explicit notice, consent time and bounded retention for internal test data',async () => {
    const { args } = await start();
    for (const [index,value] of [[1,null],[2,null],[3,''],[4,''],[5,null],[5,new Date(Date.now()+86_400_000).toISOString()],[6,null],[6,new Date(Date.now()+40*86_400_000).toISOString()]] as const) {
      const invalid = [...args]; invalid[0] = randomUUID(); invalid[index] = value as string;
      await expect(db.query('select pe_start_internal_attempt($1,$2,$3,$4,$5,$6,$7)',invalid)).rejects.toThrow('PE_INTERNAL_TEST_METADATA_REQUIRED');
    }
  });
  it('denies expired access and supports explicit erasure without deleting the instrument',async () => {
    const { id } = await start(); await write(id,0,{ SR01:4 });
    await db.query("update pe_attempts set retention_until=now()-interval '1 day' where id=$1",[id]);
    await expect(db.query('select pe_get_internal_attempt($1,$2,$3)',[id,participant,actor])).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await expect(write(id,1,{})).rejects.toThrow('PE_ATTEMPT_NOT_FOUND');
    await db.query('select pe_delete_internal_attempt($1,$2,$3)',[id,participant,actor]);
    expect((await db.query('select * from pe_attempts where id=$1',[id])).rows).toHaveLength(0);
    expect((await db.query('select * from pe_instrument_versions')).rows).toHaveLength(1);
  });
});

describe('independent SQL / TypeScript scoring parity', () => {
  it('matches for empty, all-NA, lowest, highest, and every partial-credit SJT pair',async () => {
    const cases: PEResponses[] = [{},{ SR01:4,SR02:4,SR03:5,SR04:'NA',SJ01:'B',SJ02:'B' },
      Object.fromEntries(privatePEBundle.config.self_report_items.map(i => [i.id,'NA'])) as PEResponses];
    for (const value of [1,5]) cases.push(Object.fromEntries(privatePEBundle.config.self_report_items.map(i => [i.id,value])));
    for (const c of privatePEBundle.config.competencies) {
      const [one,two] = privatePEBundle.config.sjt_items.filter(i => i.competency_code===c.code);
      for (const a of ['A','B','C','D'] as const) for (const b of ['A','B','C','D'] as const) cases.push({ [one.id]:a,[two.id]:b });
    }
    for (const responses of cases) expect(await score(responses)).toEqual(scorePEResponses(responses));
  });
  it('matches across 100 deterministic mixed/missing response snapshots',async () => {
    let state = 73;
    const next = (max: number) => { state = (state*1664525+1013904223)>>>0; return state%max; };
    for (let run=0;run<100;run++) {
      const answers: PEResponses = {};
      for (const i of privatePEBundle.config.self_report_items) {
        const value = next(7); if (value!==0) answers[i.id] = value===6 ? 'NA' : value;
      }
      for (const i of privatePEBundle.config.sjt_items) {
        const value = next(5); if (value!==0) answers[i.id] = ['A','B','C','D'][value-1] as 'A'|'B'|'C'|'D';
      }
      expect(await score(answers)).toEqual(scorePEResponses(answers));
    }
  });
});
