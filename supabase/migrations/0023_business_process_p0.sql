-- P0 hardening for the BinaHub end-to-end business process.
-- Adds explicit funnel state, campaign attribution, email suppression, and
-- an atomic transformation-event claim with a recoverable processing lease.

begin;

-- ============================================================
-- LEAD LIFECYCLE AND ATTRIBUTION
-- ============================================================
alter table public.leads
  add column if not exists lifecycle_stage text not null default 'prospect',
  add column if not exists lead_temperature text,
  add column if not exists opportunity_stage text not null default 'identified',
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists last_meaningful_activity_at timestamptz not null default now();

alter table public.leads
  drop constraint if exists leads_lifecycle_stage_valid;
alter table public.leads
  add constraint leads_lifecycle_stage_valid
  check (lifecycle_stage in ('consumer', 'prospect', 'lead', 'client', 'retained')) not valid;

alter table public.leads
  drop constraint if exists leads_temperature_valid;
alter table public.leads
  add constraint leads_temperature_valid
  check (lead_temperature is null or lead_temperature in ('cold', 'warm', 'hot')) not valid;

alter table public.leads
  drop constraint if exists leads_opportunity_stage_valid;
alter table public.leads
  add constraint leads_opportunity_stage_valid
  check (opportunity_stage in ('identified', 'qualified', 'consultation', 'proposal', 'negotiation', 'won', 'lost')) not valid;

create index if not exists leads_lifecycle_stage_idx
  on public.leads (lifecycle_stage, opportunity_stage, last_meaningful_activity_at desc);
create index if not exists leads_temperature_idx
  on public.leads (lead_temperature, lead_score desc nulls last);

alter table public.assessments
  add column if not exists attribution jsonb not null default '{}'::jsonb;

-- ============================================================
-- OUTREACH SUPPRESSION / UNSUBSCRIBE
-- ============================================================
create table if not exists public.email_suppressions (
  email text primary key,
  reason text not null default 'unsubscribe',
  source text not null default 'recipient',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_suppressions_email_normalized
    check (email = lower(btrim(email)) and length(email) between 3 and 320)
);

drop trigger if exists email_suppressions_set_updated_at on public.email_suppressions;
create trigger email_suppressions_set_updated_at
before update on public.email_suppressions
for each row execute function public.set_transformation_updated_at();

alter table public.email_suppressions enable row level security;
revoke all on table public.email_suppressions from anon, authenticated;
grant select, insert, update on table public.email_suppressions to service_role;

-- ============================================================
-- ATOMIC EVENT CLAIM WITH LEASE AND RETRY SUPPORT
-- ============================================================
alter table public.event_queue
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text;

create index if not exists event_queue_processing_lease_idx
  on public.event_queue (locked_at)
  where status = 'processing';

create or replace function public.claim_transformation_events(
  p_limit integer,
  p_worker_id text,
  p_lease_seconds integer default 900
)
returns setof public.event_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or length(btrim(p_worker_id)) < 8 then
    raise exception 'worker id is required';
  end if;

  return query
  with candidates as (
    select queue.id
    from public.event_queue as queue
    where queue.attempts < 5
      and (
        (queue.status = 'pending' and queue.available_at <= now())
        or (
          queue.status = 'processing'
          and coalesce(queue.locked_at, queue.created_at)
            <= now() - make_interval(secs => greatest(p_lease_seconds, 60))
        )
      )
    order by queue.available_at asc, queue.created_at asc
    for update skip locked
    limit least(greatest(p_limit, 1), 50)
  )
  update public.event_queue as queue
  set status = 'processing',
      attempts = queue.attempts + 1,
      locked_at = now(),
      locked_by = left(btrim(p_worker_id), 128),
      error_message = null
  from candidates
  where queue.id = candidates.id
  returning queue.*;
end;
$$;

revoke all on function public.claim_transformation_events(integer, text, integer) from public, anon, authenticated;
grant execute on function public.claim_transformation_events(integer, text, integer) to service_role;

comment on function public.claim_transformation_events(integer, text, integer) is
  'Atomically claims due transformation events. Expired processing leases are recoverable and each event is capped at five attempts.';

commit;
