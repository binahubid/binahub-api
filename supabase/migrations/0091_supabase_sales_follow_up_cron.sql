-- SQL91. Install inactive; enable once the API worker is deployed and verified.
-- SQL89 already provides pg_cron, pg_net, Vault and the private scheduler schema.
begin;

create table if not exists binahub_scheduler.sales_follow_up_dispatch_state (
  singleton boolean primary key default true check (singleton),
  request_id bigint,
  queued_at timestamptz
);
revoke all on binahub_scheduler.sales_follow_up_dispatch_state from public, anon, authenticated, service_role;
insert into binahub_scheduler.sales_follow_up_dispatch_state(singleton) values(true) on conflict do nothing;

create or replace function binahub_scheduler.sales_follow_up_cron_status()
returns jsonb language sql stable security invoker set search_path=pg_catalog as $$
  select jsonb_build_object(
    'installed', j.jobid is not null,
    'active', coalesce(j.active,false),
    'schedule', j.schedule,
    'configurationMatches', coalesce(j.command='select binahub_scheduler.dispatch_sales_follow_up();'
      and j.schedule='*/15 * * * *',false),
    'appEnabled', coalesce((select enabled from public.sales_follow_up_settings where id=true),false),
    'credentialConfigured', coalesce((binahub_scheduler.report_cron_status()->>'credentialConfigured')::boolean,false),
    'lastQueuedAt', s.queued_at,
    'httpState', case when s.request_id is null then 'never_queued'
      when r.id is null then 'pending_or_unknown'
      when r.timed_out then 'timeout'
      when r.error_msg is not null then 'transport_error'
      when r.status_code=202 then 'outside_sending_window'
      when r.status_code=207 then 'delivery_errors'
      when r.status_code=423 then 'paused_or_setup_required'
      when r.status_code=200 then 'processed'
      else 'http_error' end,
    'httpStatus', r.status_code
  ) from binahub_scheduler.sales_follow_up_dispatch_state s
  left join cron.job j on j.jobname='binahub-sales-follow-up' and j.username=current_user and j.database=current_database()
  left join lateral (select id,status_code,timed_out,error_msg from net._http_response
    where id=s.request_id order by created desc limit 1) r on true
  where s.singleton;
$$;
revoke all on function binahub_scheduler.sales_follow_up_cron_status() from public, anon, authenticated, service_role;

create or replace function binahub_scheduler.set_sales_follow_up_cron_enabled(p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare v_job bigint; v_status jsonb;
begin
  if p_enabled is null then raise exception 'An explicit true or false is required'; end if;
  select jobid into v_job from cron.job where jobname='binahub-sales-follow-up'
    and username=current_user and database=current_database();
  if v_job is null then raise exception 'Install SQL91 before changing the sales follow-up scheduler'; end if;
  if p_enabled then
    v_status := binahub_scheduler.sales_follow_up_cron_status();
    if not (v_status->>'configurationMatches')::boolean then
      raise exception 'Sales follow-up scheduler configuration does not match SQL91';
    end if;
    if not (v_status->>'credentialConfigured')::boolean then
      raise exception 'Configure binahub_report_worker_secret in Supabase Vault before activation';
    end if;
    if not (v_status->>'appEnabled')::boolean then
      raise exception 'Enable automatic follow-up in Workspace Penjualan before activating Cron';
    end if;
  end if;
  perform cron.alter_job(v_job,active:=p_enabled);
  return binahub_scheduler.sales_follow_up_cron_status();
end;
$$;
revoke all on function binahub_scheduler.set_sales_follow_up_cron_enabled(boolean) from public, anon, authenticated, service_role;

create or replace function binahub_scheduler.dispatch_sales_follow_up()
returns bigint language plpgsql security invoker set search_path=pg_catalog as $$
declare v_state binahub_scheduler.sales_follow_up_dispatch_state%rowtype; v_secret text; v_request bigint; v_status jsonb;
begin
  if not pg_try_advisory_xact_lock(914732105431::bigint) then return null; end if;
  v_status := binahub_scheduler.sales_follow_up_cron_status();
  if not (v_status->>'active')::boolean or not (v_status->>'appEnabled')::boolean then return null; end if;
  if not (v_status->>'configurationMatches')::boolean then
    raise exception 'Sales follow-up scheduler configuration does not match SQL91';
  end if;
  select * into strict v_state from binahub_scheduler.sales_follow_up_dispatch_state where singleton for update;
  if v_state.queued_at > clock_timestamp()-interval '14 minutes' then return null; end if;
  if v_state.request_id is not null and exists(select 1 from net.http_request_queue where id=v_state.request_id) then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name='binahub_report_worker_secret';
  if v_secret is null or length(v_secret) not between 32 and 512 or v_secret ~ '[[:space:][:cntrl:]]' then
    raise exception 'Sales follow-up scheduler credential is unavailable';
  end if;
  begin
    v_request := net.http_get(
      url:='https://api.binahub.id/api/admin/follow-up',
      params:='{}'::jsonb,
      headers:=jsonb_build_object('Authorization','Bearer '||v_secret,
        'X-BinaHub-Scheduler','supabase-cron','Cache-Control','no-store'),
      timeout_milliseconds:=125000
    );
  exception when others then
    raise exception 'SALES_FOLLOW_UP_CRON_DISPATCH_UNAVAILABLE' using errcode='58000';
  end;
  if v_request is null then raise exception 'SALES_FOLLOW_UP_CRON_DISPATCH_UNAVAILABLE'; end if;
  update binahub_scheduler.sales_follow_up_dispatch_state set request_id=v_request,queued_at=clock_timestamp() where singleton;
  return v_request;
end;
$$;
revoke all on function binahub_scheduler.dispatch_sales_follow_up() from public, anon, authenticated, service_role;

do $$
declare v_job bigint;
begin
  perform pg_advisory_xact_lock(914732105432::bigint);
  if exists(select 1 from cron.job where jobname='binahub-sales-follow-up'
    and (username<>current_user or database<>current_database())) then
    raise exception 'A sales follow-up scheduler with another owner/database already exists';
  end if;
  select jobid into v_job from cron.job where jobname='binahub-sales-follow-up'
    and username=current_user and database=current_database();
  if v_job is null then
    v_job := cron.schedule('binahub-sales-follow-up','*/15 * * * *','select binahub_scheduler.dispatch_sales_follow_up();');
    perform cron.alter_job(v_job,active:=false);
  elsif not (binahub_scheduler.sales_follow_up_cron_status()->>'configurationMatches')::boolean then
    raise exception 'Existing sales follow-up scheduler differs from SQL91';
  end if;
end $$;
commit;
