import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const db = new PGlite();
const migration = readFileSync('supabase/migrations/0062_assessment_background_jobs.sql', 'utf8');
beforeAll(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table assessments(id uuid primary key, scores jsonb);
    insert into assessments values('00000000-0000-0000-0000-000000000001',null);`);
  await db.exec(migration);
}, 30_000);
afterAll(async () => { await db.close(); });
const insert = async () => { const id = randomUUID(); await db.query('insert into assessments values($1,null)', [id]); return id; };
const claim = (id: string) => db.query<{ assessment_id: string; lease_token: string }>('select * from claim_assessment_job($1)', [id]);
describe('durable assessment queue', () => {
  it('does not enqueue historical records or analyzed imports', async () => {
    expect((await db.query('select * from assessment_jobs')).rows).toHaveLength(0);
    await db.query('insert into assessments values($1, $2::jsonb)', [randomUUID(), JSON.stringify({ overall: 60 })]);
    expect((await db.query('select * from assessment_jobs')).rows).toHaveLength(0);
  });
  it('atomically enqueues each new submission and claims it once', async () => {
    const id = await insert(); expect((await claim(id)).rows).toHaveLength(1);
    expect((await claim(id)).rows).toHaveLength(0);
    expect((await db.query('select attempts,status from assessment_jobs where assessment_id=$1', [id])).rows)
      .toEqual([{ attempts: 1, status: 'processing' }]);
  });
  it('rolls back queue insertion with the assessment transaction', async () => {
    const id = randomUUID(); await db.exec('begin');
    await db.query('insert into assessments values($1,null)', [id]); await db.exec('rollback');
    expect((await db.query('select * from assessment_jobs where assessment_id=$1', [id])).rows).toHaveLength(0);
  });
  it('recovers interrupted analysis with a new lease, but bounds retries', async () => {
    const id = await insert(); const oldLease = (await claim(id)).rows[0].lease_token;
    await db.query("update assessment_jobs set updated_at=now()-interval '21 minutes' where assessment_id=$1", [id]);
    expect((await claim(id)).rows[0].lease_token).not.toBe(oldLease);
    await db.query("update assessment_jobs set attempts=3,updated_at=now()-interval '21 minutes' where assessment_id=$1", [id]);
    expect((await claim(id)).rows).toHaveLength(0);
    expect((await db.query('select status from assessment_jobs where assessment_id=$1', [id])).rows).toEqual([{ status: 'failed' }]);
  });
  it('never automatically resends an email with an unknown outcome', async () => {
    const id = await insert(); await claim(id);
    await db.query("update assessment_jobs set status='emailing',updated_at=now()-interval '21 minutes' where assessment_id=$1", [id]);
    expect((await claim(id)).rows).toHaveLength(0);
    expect((await db.query('select status from assessment_jobs where assessment_id=$1', [id])).rows).toEqual([{ status: 'uncertain' }]);
  });
  it('denies public roles access and can be safely reapplied', async () => {
    expect((await db.query("select has_function_privilege('anon','claim_assessment_job(uuid)','execute') as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select has_table_privilege('authenticated','assessment_jobs','select') as allowed")).rows).toEqual([{ allowed: false }]);
    const id = await insert(); await db.exec(migration);
    expect((await db.query('select * from assessment_jobs where assessment_id=$1', [id])).rows).toHaveLength(1);
  });
});
