-- APP/API only. Wake up the existing AMS outbox when a new payload is recorded.
begin;
do $$ begin
  if to_regclass('public.consultant_notification_outbox') is null
    or to_regprocedure('binahub_scheduler.report_cron_status()') is null
  then raise exception 'Apply App/API SQL89 and SQL94 before SQL95'; end if;
end; $$;

create or replace function public.consultant_notice_claim_new(p_lease uuid,p_id uuid)
returns setof public.consultant_notification_outbox
language sql security definer set search_path=pg_catalog,public as $$
  with ready as (
    select id
    from public.consultant_notification_outbox
    where id=p_id and status='pending' and attempts=0 and available_at<=now() and payload<>'{}'::jsonb
    for update skip locked
  )
  update public.consultant_notification_outbox o
  set status='processing', lease_token=p_lease, lease_until=now()+interval '2 minutes', attempts=o.attempts+1
  from ready where o.id=ready.id
  returning o.*;
$$;
revoke all on function public.consultant_notice_claim_new(uuid,uuid) from public,anon,authenticated;
grant execute on function public.consultant_notice_claim_new(uuid,uuid) to service_role;

create or replace function binahub_scheduler.dispatch_new_consultant_notice()
returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
declare worker_secret text;
begin
  select decrypted_secret into worker_secret from vault.decrypted_secrets where name='binahub_report_worker_secret';
  if worker_secret is null or length(worker_secret) not between 32 and 512 or worker_secret ~ '[[:space:][:cntrl:]]' then return null; end if;

  perform net.http_post(
    url:='https://api.binahub.id/api/integrations/ams/notification-dispatch',
    headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||worker_secret),
    body:=jsonb_build_object('id',new.id),
    timeout_milliseconds:=20000
  );
  return null;
exception when others then
  raise log 'Consultant notification wake-up deferred to Cron (%).', sqlstate;
  return null;
end; $$;
revoke all on function binahub_scheduler.dispatch_new_consultant_notice() from public,anon,authenticated,service_role;
drop trigger if exists consultant_notice_dispatch_new on public.consultant_notification_outbox;
create trigger consultant_notice_dispatch_new after update of payload on public.consultant_notification_outbox
for each row when (old.payload='{}'::jsonb and new.payload<>'{}'::jsonb)
execute function binahub_scheduler.dispatch_new_consultant_notice();
commit;
