-- R06: read-only queue summaries and a report-worker heartbeat. No job is claimed,
-- retried, deleted or sent; scheduler activation remains an operator decision.
begin;

do $$ begin
  if to_regclass('public.assessment_jobs') is null
    or to_regclass('public.pe_report_email_jobs') is null
    or to_regclass('public.spin_submissions') is null
    or to_regclass('public.spin_mail_jobs') is null then
    raise exception 'SERVICE_HEALTH_SQL62_67_71_REQUIRED';
  end if;
end $$;

create table if not exists public.service_worker_heartbeats (
  worker_key text primary key check(worker_key='report_delivery'),
  run_token uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  succeeded_at timestamptz,
  outcome text not null check(outcome in ('running','ok','degraded','error'))
);
alter table public.service_worker_heartbeats enable row level security;
revoke all on public.service_worker_heartbeats from public,anon,authenticated,service_role;

create or replace function public.begin_report_worker_heartbeat(p_run_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_run_token is null then raise exception 'WORKER_HEARTBEAT_INVALID'; end if;
  insert into public.service_worker_heartbeats(worker_key,run_token,started_at,outcome)
    values('report_delivery',p_run_token,now(),'running')
    on conflict(worker_key) do update set run_token=excluded.run_token,
      started_at=excluded.started_at,finished_at=null,outcome='running';
  return true;
end $$;

create or replace function public.finish_report_worker_heartbeat(p_run_token uuid,p_outcome text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_run_token is null or p_outcome is null or p_outcome not in ('ok','degraded','error') then
    raise exception 'WORKER_HEARTBEAT_INVALID';
  end if;
  update public.service_worker_heartbeats set finished_at=now(),outcome=p_outcome,
    succeeded_at=case when p_outcome='ok' then now() else succeeded_at end
    where worker_key='report_delivery' and run_token=p_run_token and outcome='running';
  return found;
end $$;

create or replace function public.read_service_health_snapshot()
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  with queues as (
    select 'team_analysis' as key,
      count(*) filter(where status='pending') as pending,
      count(*) filter(where status in ('processing','emailing')) as processing,
      count(*) filter(where status='pending' and available_at<=now()-interval '10 minutes') as overdue,
      count(*) filter(where status in ('processing','emailing') and updated_at<now()-interval '20 minutes') as stalled,
      count(*) filter(where status in ('failed','uncertain')) as review,
      min(available_at) filter(where status='pending' and available_at<=now()) as oldest_due_at
    from public.assessment_jobs where status<>'completed'
    union all
    select 'individual_email',count(*) filter(where status='pending'),
      count(*) filter(where status='processing'),
      count(*) filter(where status='pending' and available_at<=now()-interval '10 minutes'),
      count(*) filter(where status='processing' and (lease_until is null or lease_until<=now())),
      count(*) filter(where status in ('failed','uncertain')),
      min(available_at) filter(where status='pending' and available_at<=now())
    from public.pe_report_email_jobs where status<>'sent'
    union all
    select 'program_analysis',count(*) filter(where status='queued'),
      count(*) filter(where status='processing'),
      count(*) filter(where status='queued' and next_attempt_at<=now()-interval '10 minutes'),
      count(*) filter(where status='processing' and (lease_until is null or lease_until<=now())),
      count(*) filter(where status='failed'),
      min(next_attempt_at) filter(where status='queued' and next_attempt_at<=now())
    from public.spin_submissions where status in ('queued','processing','failed')
    union all
    select 'program_email',count(*) filter(where status='pending'),
      count(*) filter(where status='sending'),
      count(*) filter(where status='pending' and next_attempt_at<=now()-interval '10 minutes'),
      count(*) filter(where status='sending' and (lease_until is null or lease_until<=now())),
      count(*) filter(where status in ('failed','uncertain')),
      min(next_attempt_at) filter(where status='pending' and next_attempt_at<=now())
    from public.spin_mail_jobs where status<>'sent'
  )
  select jsonb_build_object(
    'version',1,'checkedAt',now(),'overdueMinutes',10,'workerStaleMinutes',10,
    'queues',(select jsonb_agg(jsonb_build_object('key',key,'pending',pending,'processing',processing,
      'overdue',overdue,'stalled',stalled,'review',review,'oldestDueAt',oldest_due_at) order by key) from queues),
    'worker',(select jsonb_build_object('startedAt',started_at,'finishedAt',finished_at,
      'succeededAt',succeeded_at,'outcome',outcome)
      from public.service_worker_heartbeats where worker_key='report_delivery')
  );
$$;

revoke all on function public.begin_report_worker_heartbeat(uuid) from public,anon,authenticated;
revoke all on function public.finish_report_worker_heartbeat(uuid,text) from public,anon,authenticated;
revoke all on function public.read_service_health_snapshot() from public,anon,authenticated;
grant execute on function public.begin_report_worker_heartbeat(uuid) to service_role;
grant execute on function public.finish_report_worker_heartbeat(uuid,text) to service_role;
grant execute on function public.read_service_health_snapshot() to service_role;
notify pgrst,'reload schema';
commit;
