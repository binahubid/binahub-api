begin;

create table if not exists public.runtime_error_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null check (length(fingerprint) = 64),
  bucket date not null default (now() at time zone 'UTC')::date,
  trusted boolean not null default false,
  synthetic boolean not null default false,
  code text not null check (length(code) <= 80),
  route text not null check (length(route) <= 300),
  message text not null check (length(message) between 1 and 1000),
  stack text not null default '' check (length(stack) <= 6000),
  release text not null default '' check (length(release) <= 100),
  occurrence_count integer not null default 1 check (occurrence_count > 0),
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  unique (fingerprint, bucket)
);
create index if not exists runtime_error_events_open_recent
  on public.runtime_error_events(status, last_seen_at desc);
alter table public.runtime_error_events enable row level security;
revoke all on public.runtime_error_events from public, anon, authenticated;
grant select, insert, update, delete on public.runtime_error_events to service_role;

create or replace function public.record_runtime_error(
  p_fingerprint text, p_trusted boolean, p_synthetic boolean,
  p_message text, p_stack text, p_route text, p_code text, p_release text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare saved_id uuid;
begin
  -- Never silently expire unacknowledged errors. Bound housekeeping per insert.
  delete from public.runtime_error_events where id in (
    select id from public.runtime_error_events
    where status = 'acknowledged' and last_seen_at < now() - interval '30 days'
    order by last_seen_at limit 100
  );
  insert into public.runtime_error_events
    (fingerprint, trusted, synthetic, message, stack, route, code, release)
  values (p_fingerprint, p_trusted, p_synthetic, p_message, p_stack, p_route, p_code, p_release)
  on conflict (fingerprint, bucket) do update
    set occurrence_count = public.runtime_error_events.occurrence_count + 1,
        last_seen_at = now(), status = 'open', acknowledged_at = null, acknowledged_by = null
  returning id into saved_id;
  return saved_id;
end;
$$;
revoke all on function public.record_runtime_error(text,boolean,boolean,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_runtime_error(text,boolean,boolean,text,text,text,text,text)
  to service_role;
notify pgrst, 'reload schema';
commit;
