import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import catalog from '@/data/competency-catalog-2026.json';
import { preparePEDeployment, PRIVATE_INSTALL_VERIFICATION } from '../../../scripts/prepare-pe-deployment.mjs';
import { makeSyntheticPEInstrument } from './synthetic-fixture';

const db = new PGlite();
const schema = readFileSync('supabase/migrations/0064_personal_effectiveness_foundation.sql', 'utf8');
const delivery = readFileSync('supabase/migrations/0065_personal_effectiveness_delivery.sql', 'utf8');
const bundle = makeSyntheticPEInstrument();
const complete = preparePEDeployment(bundle, schema);

beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table catalog_modules(id uuid primary key default gen_random_uuid(),module_code text unique,
      is_mock boolean default false,catalog_version text default 'signature-2026-ceo-v1',
      base_price numeric default 25000000,metadata jsonb default '{}');`);
  for (const solution of catalog.solutions) {
    await db.query('insert into catalog_modules(module_code) values($1)', [solution.moduleCode]);
  }
  await db.exec(readFileSync('supabase/migrations/0063_competency_dictionary.sql', 'utf8'));
  await db.exec(schema);
}, 30_000);
afterAll(() => db.close());

describe('SQL 64 complete installation and SQL 65 recovery sequence', () => {
  it('reproduces the missing private source after public SQL 64 and rolls back SQL 65', async () => {
    expect((await db.query('select count(*)::int as n from pe_instrument_versions')).rows).toEqual([{ n: 0 }]);
    await expect(db.exec(delivery)).rejects.toThrow('PE_PRIVATE_SOURCE_REQUIRED');
    await db.exec('rollback;');
    expect((await db.query("select to_regclass('public.pe_delivery_policies')::text as name")).rows).toEqual([{ name: null }]);
    await expect(db.exec(`begin;${PRIVATE_INSTALL_VERIFICATION}commit;`)).rejects.toThrow('PE_PRIVATE_SOURCE_REQUIRED');
    await db.exec('rollback;');
  });
  it('installs the private source and six mappings before SQL 65 succeeds', async () => {
    const outputs = await db.exec(complete);
    expect(outputs.flatMap(output => output.rows)).toContainEqual({
      instrument_id: 'BINAINSIGHTS-PE-V1', version: '1.0.0-draft.1', competency_count: 6,
      self_report_question_count: 24, scenario_question_count: 12, catalog_mapping_count: 6,
    });
    await db.exec(delivery);
    expect((await db.query('select manifest from pe_instrument_versions')).rows).toEqual([{ manifest: bundle }]);
    expect((await db.query("select count(*)::int as n from pe_catalog_crosswalks where status='approved'")).rows).toEqual([{ n: 6 }]);
    expect((await db.query('select count(*)::int as n from pe_participant_attempts')).rows).toEqual([{ n: 0 }]);
  });
  it('preserves drafts, submitted results and approved reviews when both SQL files are reapplied', async () => {
    const id = randomUUID(), submittedId = randomUUID(), owner = randomUUID();
    const context = { role: 'Synthetic tester', goal: 'Synthetic goal', relevance: { 'PE-02': 'normal', 'PE-04': 'normal', 'PE-06': 'normal' } };
    await db.query('select pe_start_participant($1,$2,$3::jsonb,$4,$5)', [id, owner, JSON.stringify(context), 'pe-development-consent-v1', 'pe-personal-privacy-v1']);
    await db.query('select pe_write_participant($1,$2,0,$3::jsonb,null)', [id, owner, JSON.stringify({ SR05: 4 })]);
    await db.query('select pe_start_participant($1,$2,$3::jsonb,$4,$5)', [submittedId, owner, JSON.stringify(context), 'pe-development-consent-v1', 'pe-personal-privacy-v1']);
    const freeCodes = ['PE-02', 'PE-04', 'PE-06'];
    const answers = Object.fromEntries([
      ...bundle.config.self_report_items.filter(item => freeCodes.includes(item.competency_code)).map(item => [item.id, 4]),
      ...bundle.config.sjt_items.filter(item => freeCodes.includes(item.competency_code)).map(item => [item.id, 'A']),
    ]);
    await db.query('select pe_write_participant($1,$2,0,$3::jsonb,$4)', [submittedId, owner, JSON.stringify(answers), randomUUID()]);
    const beforeAttempts = (await db.query('select * from pe_participant_attempts order by id')).rows;
    const beforeReviews = (await db.query('select * from pe_catalog_crosswalks order by pe_code')).rows;
    await db.exec(complete);
    await db.exec(delivery);
    expect((await db.query('select * from pe_participant_attempts order by id')).rows).toEqual(beforeAttempts);
    expect((await db.query('select * from pe_catalog_crosswalks order by pe_code')).rows).toEqual(beforeReviews);
    expect((await db.query('select manifest from pe_instrument_versions')).rows).toEqual([{ manifest: bundle }]);
  });
});
