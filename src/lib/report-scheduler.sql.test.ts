import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Real PL/pgSQL, roles, locks and transactions; only unavailable hosted extensions
// are replaced with local fixtures. No network, Supabase login or real credential.
const db = new PGlite();
const migration = readFileSync('supabase/migrations/0089_supabase_report_scheduler.sql', 'utf8');
const fixtureMigration = migration.replace(/^create extension if not exists (pg_cron|pg_net);$/gm, '');
const command = 'select binahub_scheduler.dispatch_report_worker();';
const secret = 'synthetic-only-report-worker-secret-123456789';
type Status = { installed: boolean; active: boolean; schedule: string; configurationMatches: boolean;
  credentialConfigured: boolean; lastQueuedAt: string | null; httpState: string; httpStatus: number | null };
const status = async () => (await db.query<{ value: Status }>('select binahub_scheduler.report_cron_status() value')).rows[0].value;
const enable = (enabled = true) => db.query('select binahub_scheduler.set_report_cron_enabled($1)', [enabled]);
const dispatch = async () => (await db.query<{ value: number | null }>('select binahub_scheduler.dispatch_report_worker() value')).rows[0].value;
const apply = async () => { try { await db.exec(fixtureMigration); } catch (error) { await db.exec('rollback'); throw error; } };
const putSecret = (value = secret) => db.query('insert into vault.secrets values($1,$2)', ['binahub_report_worker_secret', value]);
const start = async () => { await putSecret(); await enable(); };
const age = () => db.exec("update binahub_scheduler.report_dispatch_state set queued_at=now()-interval '4 minutes'");

beforeAll(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema vault;create table vault.secrets(name text primary key,decrypted_secret text);
    create view vault.decrypted_secrets as select * from vault.secrets;
    create schema cron;
    create table cron.job(jobid bigserial primary key,jobname text,schedule text,command text,
      username text default current_user,database text default current_database(),active boolean default true,unique(jobname,username));
    create function cron.schedule(job_name text,schedule text,command text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values(job_name,schedule,command)
      on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command returning jobid;
    $$;
    create function cron.alter_job(job_id bigint,schedule text default null,command text default null,
      database text default null,username text default null,active boolean default null) returns void language sql as $$
      update cron.job set active=coalesce(alter_job.active,job.active) where jobid=job_id;
    $$;
    create schema net;
    create table net.http_request_queue(id bigserial primary key,url text,params jsonb,headers jsonb,timeout_milliseconds int);
    grant select on net.http_request_queue to public,anon,authenticated;
    create table net._http_response(id bigint,status_code int,timed_out boolean default false,error_msg text,content text,created timestamptz default now());
    create table net.behavior(fail boolean);insert into net.behavior values(false);
    create function net.http_get(url text,params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds int default 5000)
      returns bigint language plpgsql as $$ declare request_id bigint; begin
        if (select fail from net.behavior) then raise exception 'PRIVATE_SYNTHETIC_TRANSPORT_%',headers; end if;
        insert into net.http_request_queue(url,params,headers,timeout_milliseconds)
          values(url,params,headers,timeout_milliseconds) returning id into request_id;
        return request_id;
      end $$;
  `);
  await apply();
}, 30_000);
afterAll(() => db.close());
beforeEach(async () => {
  await db.exec(`reset role;truncate vault.secrets,net.http_request_queue,net._http_response;
    update net.behavior set fail=false;
    update binahub_scheduler.report_dispatch_state set request_id=null,queued_at=null;
    delete from cron.job where jobname<>'binahub-report-recovery';`);
  await db.query('update cron.job set command=$1,schedule=$2,active=false,username=current_user,database=current_database()', [command, '* * * * *']);
});

describe('SQL89 Supabase report scheduler (extension fixtures, no live network)', () => {
  it('installs inactive and never queues a request during install or a status check', async () => {
    await apply();
    expect(await status()).toMatchObject({ installed: true, active: false, schedule: '* * * * *', configurationMatches: true,
      credentialConfigured: false, lastQueuedAt: null, httpState: 'never_queued', httpStatus: null });
    expect(await dispatch()).toBeNull();
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0);
  });
  it('requires Vault configuration before activation without leaking a secret', async () => {
    await expect(enable()).rejects.toThrow('Configure binahub_report_worker_secret');
    expect((await status()).active).toBe(false);
  });
  it.each(['short', 'x'.repeat(513), 'x'.repeat(32) + '\n', 'x'.repeat(20) + ' ' + 'y'.repeat(20)])('rejects malformed Vault value %#', async value => {
    await putSecret(value); expect((await status()).credentialConfigured).toBe(false);
    await expect(enable()).rejects.toThrow('Configure binahub_report_worker_secret');
    expect((await status()).active).toBe(false);
  });
  it('activation does not invoke the worker; dispatch uses fixed GET destination and header only', async () => {
    await putSecret();
    expect((await db.query<{ value: Status }>('select binahub_scheduler.set_report_cron_enabled(true) value')).rows[0].value.active).toBe(true);
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0);
    const id = await dispatch(); expect(id).not.toBeNull();
    expect((await db.query('select * from net.http_request_queue')).rows).toEqual([
      { id, url: 'https://api.binahub.id/api/assessment/worker', params: {},
        headers: { Authorization: 'Bearer ' + secret, 'Cache-Control': 'no-store' }, timeout_milliseconds: 125000 },
    ]);
    expect(JSON.stringify(await status())).not.toContain(secret);
    expect((await status()).httpState).toBe('pending_or_unknown');
  });
  it('does not accumulate requests if pg_net has not drained its queue', async () => {
    await start(); const id = await dispatch(); await age(); expect(await dispatch()).toBeNull();
    expect((await db.query('select id from net.http_request_queue')).rows).toEqual([{ id }]);
  });
  it('waits for the in-flight HTTP response; bounded unknown outcomes can recover after restart', async () => {
    await start(); await dispatch(); await db.exec('truncate net.http_request_queue');
    await db.exec("update binahub_scheduler.report_dispatch_state set queued_at=now()-interval '2 minutes'");
    expect(await dispatch()).toBeNull(); await age(); expect(await dispatch()).not.toBeNull();
  });
  it('rate limits an immediate second call even after a completed response', async () => {
    await start(); const id = await dispatch(); await db.exec('truncate net.http_request_queue');
    await db.query('insert into net._http_response(id,status_code) values($1,200)', [id]);
    expect(await dispatch()).toBeNull(); await age(); expect(await dispatch()).not.toBeNull();
  });
  it('reports HTTP acceptance separately from worker/job/email success and omits response body/errors', async () => {
    await start(); const id = await dispatch();
    await db.query('insert into net._http_response(id,status_code,content) values($1,200,$2)', [id, 'PRIVATE_PARTICIPANT_BODY']);
    expect(await status()).toMatchObject({ httpState: 'accepted_by_worker', httpStatus: 200 });
    expect(JSON.stringify(await status())).not.toContain('PRIVATE');
    await db.query('update net._http_response set status_code=401,error_msg=null where id=$1', [id]);
    expect(await status()).toMatchObject({ httpState: 'http_error', httpStatus: 401 });
    await db.query('update net._http_response set status_code=null,timed_out=true,error_msg=$2 where id=$1', [id, 'PRIVATE_URL_OR_TOKEN']);
    expect((await status()).httpState).toBe('timeout'); expect(JSON.stringify(await status())).not.toContain('PRIVATE');
    await db.query('update net._http_response set timed_out=false where id=$1', [id]);
    expect((await status()).httpState).toBe('transport_error');
  });
  it('pauses future dispatch without cancelling or deleting an in-flight request', async () => {
    await start(); const id = await dispatch(); await enable(false); await age(); expect(await dispatch()).toBeNull();
    expect((await db.query('select id from net.http_request_queue')).rows).toEqual([{ id }]);
    expect((await status()).active).toBe(false);
  });
  it('can pause after credential removal and refuses to dispatch with a missing credential', async () => {
    await start(); await db.exec('truncate vault.secrets');
    await expect(dispatch()).rejects.toThrow('Report scheduler credential is unavailable');
    await enable(false); expect((await status()).active).toBe(false);
  });
  it('reapplication preserves activation, pause, job identity, state and unrelated/PETA jobs', async () => {
    await db.query("select cron.schedule('peta-monthly','0 0 1 * *','select 1')");
    await start(); const id = await dispatch();
    const before = (await db.query('select * from cron.job order by jobid')).rows;
    await apply(); expect((await db.query('select * from cron.job order by jobid')).rows).toEqual(before);
    expect((await db.query('select request_id from binahub_scheduler.report_dispatch_state')).rows).toEqual([{ request_id: id }]);
    await enable(false); await apply(); expect((await status()).active).toBe(false);
  });
  it('fails closed for a modified job rather than overwriting someone else\'s schedule', async () => {
    await putSecret(); await db.query('update cron.job set command=$1', ['select 123']);
    await expect(enable()).rejects.toThrow('does not match SQL89');
    await expect(apply()).rejects.toThrow('differs from SQL89');
    expect((await db.query('select command from cron.job')).rows).toEqual([{ command: 'select 123' }]);
  });
  it('rejects another owner/database instead of creating a duplicate named cron', async () => {
    await db.exec("update cron.job set username='someone_else'");
    await expect(apply()).rejects.toThrow('another owner/database');
    expect((await db.query('select count(*)::int n from cron.job')).rows).toEqual([{ n: 1 }]);
  });
  it('denies controls/state to API roles and queued header reads to browser roles', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      for (const fn of ['report_cron_status()', 'set_report_cron_enabled(boolean)', 'dispatch_report_worker()']) {
        expect((await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'execute\') allowed', [role, 'binahub_scheduler.' + fn])).rows[0].allowed).toBe(false);
      }
      expect((await db.query<{ allowed: boolean }>('select has_table_privilege($1,\'binahub_scheduler.report_dispatch_state\',\'select\') allowed', [role])).rows[0].allowed).toBe(false);
      await db.exec('set role ' + role);
      await expect(status()).rejects.toThrow('permission denied'); await db.exec('reset role');
    }
    for (const role of ['anon', 'authenticated']) {
      expect((await db.query<{ allowed: boolean }>('select has_table_privilege($1,\'net.http_request_queue\',\'select\') allowed', [role])).rows[0].allowed).toBe(false);
    }
    expect((await db.query('select prosecdef from pg_proc where oid=\'binahub_scheduler.dispatch_report_worker()\'::regprocedure')).rows).toEqual([{ prosecdef: false }]);
  });
  it('does not expose raw transport diagnostics or commit partial enqueue state on failure', async () => {
    await start(); await db.exec('update net.behavior set fail=true');
    await expect(dispatch()).rejects.toThrow(/^REPORT_CRON_DISPATCH_UNAVAILABLE$/);
    expect((await status()).lastQueuedAt).toBeNull();
    expect((await db.query('select * from net.http_request_queue')).rows).toHaveLength(0);
  });
  it('requires explicit activation/deactivation and does not install cleanup/outreach schedules', async () => {
    await expect(db.exec('select binahub_scheduler.set_report_cron_enabled(null)')).rejects.toThrow('explicit true or false');
    expect((await db.query('select jobname from cron.job')).rows).toEqual([{ jobname: 'binahub-report-recovery' }]);
    expect(migration.match(/^create extension /gm)).toHaveLength(2);
    expect(migration).not.toContain('vault.create_secret(');
  });
});
