-- SQL89: install report recovery on Supabase Cron, INACTIVE on first install.
-- No HTTP requests, AI calls, emails or participant cleanup during installation.
-- Activate explicitly after Vault configuration and deployment checks; see runbook.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$ begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Enable Supabase Vault before applying SQL89';
  end if;
  if to_regclass('net.http_request_queue') is null or to_regclass('net._http_response') is null then
    raise exception 'The installed pg_net schema is not supported by SQL89';
  end if;
end $$;

create schema if not exists binahub_scheduler;
revoke all on schema binahub_scheduler from public, anon, authenticated, service_role;
-- pg_net temporarily holds decrypted Authorization headers. Do not expose them
-- through PUBLIC/browser roles. This does not change other jobs or HTTP functions.
revoke select on table net.http_request_queue from public, anon, authenticated;

create table if not exists binahub_scheduler.report_dispatch_state (
  singleton boolean primary key default true check (singleton),
  request_id bigint,
  queued_at timestamptz
);
revoke all on binahub_scheduler.report_dispatch_state from public, anon, authenticated, service_role;
insert into binahub_scheduler.report_dispatch_state(singleton) values(true) on conflict do nothing;

create or replace function binahub_scheduler.report_cron_status()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'installed', j.jobid is not null,
    'active', coalesce(j.active,false),
    'schedule', j.schedule,
    'configurationMatches', coalesce(j.command='select binahub_scheduler.dispatch_report_worker();'
      and j.schedule='* * * * *' and j.username=current_user and j.database=current_database(),false),
    'credentialConfigured', exists(select 1 from vault.decrypted_secrets v
      where v.name='binahub_report_worker_secret' and length(v.decrypted_secret) between 32 and 512
      and v.decrypted_secret !~ '[[:space:][:cntrl:]]'),
    'lastQueuedAt', s.queued_at,
    'httpState', case when s.request_id is null then 'never_queued'
      when r.id is null then 'pending_or_unknown'
      when r.timed_out then 'timeout'
      when r.error_msg is not null then 'transport_error'
      when r.status_code between 200 and 299 then 'accepted_by_worker'
      else 'http_error' end,
    'httpStatus', r.status_code
  ) from binahub_scheduler.report_dispatch_state s
  left join cron.job j on j.jobname='binahub-report-recovery' and j.username=current_user and j.database=current_database()
  left join lateral (select id,status_code,timed_out,error_msg from net._http_response
    where id=s.request_id order by created desc limit 1) r on true
  where s.singleton;
$$;
revoke all on function binahub_scheduler.report_cron_status() from public, anon, authenticated, service_role;

create or replace function binahub_scheduler.set_report_cron_enabled(p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_job bigint; v_secret text;
begin
  if p_enabled is null then raise exception 'An explicit true or false is required'; end if;
  select j.jobid into v_job from cron.job j
    where j.jobname='binahub-report-recovery' and j.username=current_user and j.database=current_database();
  if v_job is null then raise exception 'Install SQL89 before changing the report scheduler'; end if;
  if p_enabled then
    if not coalesce((binahub_scheduler.report_cron_status()->>'configurationMatches')::boolean,false) then
      raise exception 'Report scheduler configuration does not match SQL89';
    end if;
    select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name='binahub_report_worker_secret';
    if v_secret is null or length(v_secret) not between 32 and 512 or v_secret ~ '[[:space:][:cntrl:]]' then
      raise exception 'Configure binahub_report_worker_secret in Supabase Vault before activation';
    end if;
  end if;
  perform cron.alter_job(v_job,active:=p_enabled);
  return binahub_scheduler.report_cron_status();
end;
$$;
revoke all on function binahub_scheduler.set_report_cron_enabled(boolean) from public, anon, authenticated, service_role;

create or replace function binahub_scheduler.dispatch_report_worker()
returns bigint language plpgsql security invoker set search_path=pg_catalog as $$
declare v_state binahub_scheduler.report_dispatch_state%rowtype; v_secret text; v_request bigint;
begin
  -- The HTTP operation is asynchronous; pg_cron's SQL-run lock alone cannot
  -- prevent a second in-flight HTTP request. Serialize enqueue and inspect it.
  if not pg_try_advisory_xact_lock(894732105431::bigint) then return null; end if;
  if not coalesce((binahub_scheduler.report_cron_status()->>'active')::boolean,false) then return null; end if;
  if not coalesce((binahub_scheduler.report_cron_status()->>'configurationMatches')::boolean,false) then
    raise exception 'Report scheduler configuration does not match SQL89';
  end if;
  select * into strict v_state from binahub_scheduler.report_dispatch_state where singleton for update;
  if v_state.queued_at > clock_timestamp()-interval '55 seconds' then return null; end if;
  if v_state.request_id is not null then
    -- An undrained pg_net queue must not grow by one request per minute.
    if exists(select 1 from net.http_request_queue where id=v_state.request_id) then return null; end if;
    if v_state.queued_at > clock_timestamp()-interval '3 minutes'
       and not exists(select 1 from net._http_response where id=v_state.request_id) then return null; end if;
  end if;
  select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name='binahub_report_worker_secret';
  if v_secret is null or length(v_secret) not between 32 and 512 or v_secret ~ '[[:space:][:cntrl:]]' then
    raise exception 'Report scheduler credential is unavailable';
  end if;
  -- Fixed HTTPS destination/path: no arbitrary URL, redirects in app code,
  -- service-role key, answers, contact data or credentials in query strings.
  begin
    v_request := net.http_get(
      url:='https://api.binahub.id/api/assessment/worker',
      params:='{}'::jsonb,
      headers:=jsonb_build_object('Authorization','Bearer '||v_secret,'Cache-Control','no-store'),
      timeout_milliseconds:=125000
    );
  exception when others then
    raise exception 'REPORT_CRON_DISPATCH_UNAVAILABLE' using errcode='58000';
  end;
  if v_request is null then raise exception 'REPORT_CRON_DISPATCH_UNAVAILABLE'; end if;
  update binahub_scheduler.report_dispatch_state set request_id=v_request,queued_at=clock_timestamp() where singleton;
  return v_request;
end;
$$;
revoke all on function binahub_scheduler.dispatch_report_worker() from public, anon, authenticated, service_role;

-- Atomic first install: no active schedule becomes visible before COMMIT.
-- Reapplication preserves an existing job ID, pause/activation and dispatch state.
do $$
declare v_job bigint;
begin
  perform pg_advisory_xact_lock(894732105432::bigint);
  if exists(select 1 from cron.job where jobname='binahub-report-recovery'
    and (username<>current_user or database<>current_database())) then
    raise exception 'A report scheduler with another owner/database already exists';
  end if;
  select jobid into v_job from cron.job where jobname='binahub-report-recovery'
    and username=current_user and database=current_database();
  if v_job is null then
    v_job := cron.schedule('binahub-report-recovery','* * * * *','select binahub_scheduler.dispatch_report_worker();');
    perform cron.alter_job(v_job,active:=false);
  elsif not coalesce((binahub_scheduler.report_cron_status()->>'configurationMatches')::boolean,false) then
    raise exception 'Existing report scheduler differs from SQL89; inspect it before reapplying';
  end if;
end $$;
commit;
