-- Phase 19 hardening: make pilot audience enforceable and automation retries immutable.

begin;

create table if not exists public.pilot_release_recipients (
  release_id uuid not null references public.pilot_release_plans(id) on delete cascade,
  email text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (release_id, email),
  constraint pilot_release_recipients_email_valid check (
    email = lower(btrim(email))
    and length(email) between 3 and 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint pilot_release_recipients_actor_valid check (length(btrim(created_by)) between 3 and 320)
);

create index if not exists pilot_release_recipients_email_idx
  on public.pilot_release_recipients (email, release_id);

alter table public.pilot_release_recipients enable row level security;
revoke all on table public.pilot_release_recipients from public, anon, authenticated;
grant select, insert, delete on table public.pilot_release_recipients to service_role;

alter table public.pilot_release_events
  drop constraint if exists pilot_release_events_type_valid;
alter table public.pilot_release_events
  add constraint pilot_release_events_type_valid check (
    event_type in (
      'created', 'plan_updated', 'audience_updated', 'review_requested', 'approved',
      'rejected', 'scheduled', 'paused', 'rolled_back', 'completed',
      'operational_review_recorded'
    )
  );

create or replace function public.save_pilot_release_plan_with_audience(
  p_release_id uuid,
  p_actor text,
  p_release_key text,
  p_title text,
  p_cohort_description text,
  p_maximum_participants integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_business_owner text,
  p_technical_owner text,
  p_monitoring_owner text,
  p_success_criteria jsonb,
  p_rollback_triggers jsonb,
  p_rollback_plan text,
  p_is_mock boolean,
  p_recipient_emails jsonb
)
returns public.pilot_release_plans
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.pilot_release_plans%rowtype;
  recipient_count integer := 0;
  invalid_count integer := 0;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
begin
  if jsonb_typeof(coalesce(p_recipient_emails, '[]'::jsonb)) <> 'array' then
    raise exception 'PILOT_AUDIENCE_ARRAY_REQUIRED' using errcode = '22023';
  end if;

  with normalized as (
    select distinct lower(btrim(value)) as email
    from jsonb_array_elements_text(coalesce(p_recipient_emails, '[]'::jsonb))
    where length(btrim(value)) > 0
  )
  select count(*), count(*) filter (
    where length(email) not between 3 and 320
      or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
  into recipient_count, invalid_count
  from normalized;

  if recipient_count < 1 then
    raise exception 'PILOT_AUDIENCE_REQUIRED' using errcode = '22023';
  end if;
  if invalid_count > 0 then
    raise exception 'PILOT_AUDIENCE_EMAIL_INVALID' using errcode = '22023';
  end if;
  if recipient_count > p_maximum_participants then
    raise exception 'PILOT_AUDIENCE_EXCEEDS_MAXIMUM' using errcode = '22023';
  end if;

  saved := public.save_pilot_release_plan(
    p_release_id,
    normalized_actor,
    p_release_key,
    p_title,
    p_cohort_description,
    p_maximum_participants,
    p_starts_at,
    p_ends_at,
    p_business_owner,
    p_technical_owner,
    p_monitoring_owner,
    p_success_criteria,
    p_rollback_triggers,
    p_rollback_plan,
    p_is_mock
  );

  delete from public.pilot_release_recipients where release_id = saved.id;
  insert into public.pilot_release_recipients (release_id, email, created_by)
  select saved.id, email, normalized_actor
  from (
    select distinct lower(btrim(value)) as email
    from jsonb_array_elements_text(p_recipient_emails)
    where length(btrim(value)) > 0
  ) normalized;

  insert into public.pilot_release_events (
    release_id, event_type, actor, after_snapshot, note
  ) values (
    saved.id,
    'audience_updated',
    normalized_actor,
    jsonb_build_object('recipientCount', recipient_count, 'maximumParticipants', saved.maximum_participants),
    'Daftar penerima pilot diganti secara atomik; alamat email tidak disalin ke audit event.'
  );

  return saved;
end;
$$;

create or replace function public.enforce_pilot_release_audience()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  recipient_count integer;
begin
  if new.status in ('review_requested', 'approved', 'scheduled')
    and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    select count(*) into recipient_count
    from public.pilot_release_recipients
    where release_id = new.id;

    if recipient_count < 1 then
      raise exception 'PILOT_AUDIENCE_REQUIRED' using errcode = '55000';
    end if;
    if recipient_count > new.maximum_participants then
      raise exception 'PILOT_AUDIENCE_EXCEEDS_MAXIMUM' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_pilot_release_audience_trigger on public.pilot_release_plans;
create trigger enforce_pilot_release_audience_trigger
before insert or update on public.pilot_release_plans
for each row execute function public.enforce_pilot_release_audience();

create or replace function public.enforce_runtime_release_audience()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  recipient_count integer;
  maximum_participants integer;
begin
  if new.requested_mode in ('pilot', 'live') then
    select plan.maximum_participants, count(recipient.email)
    into maximum_participants, recipient_count
    from public.pilot_release_plans plan
    left join public.pilot_release_recipients recipient on recipient.release_id = plan.id
    where plan.id = new.pilot_release_id
    group by plan.maximum_participants;

    if maximum_participants is null or recipient_count < 1 then
      raise exception 'RUNTIME_RELEASE_AUDIENCE_REQUIRED' using errcode = '55000';
    end if;
    if recipient_count > maximum_participants then
      raise exception 'RUNTIME_RELEASE_AUDIENCE_EXCEEDS_MAXIMUM' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_runtime_release_audience_trigger on public.automation_runtime_controls;
create trigger enforce_runtime_release_audience_trigger
before insert or update on public.automation_runtime_controls
for each row execute function public.enforce_runtime_release_audience();

revoke all on function public.save_pilot_release_plan_with_audience(
  uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean,jsonb
) from public, anon, authenticated;
grant execute on function public.save_pilot_release_plan_with_audience(
  uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean,jsonb
) to service_role;

comment on table public.pilot_release_recipients is
  'Exact release audience. Live or pilot workers must fail closed when an address is not listed here.';
comment on function public.save_pilot_release_plan_with_audience(
  uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean,jsonb
) is 'Atomically saves a pilot release and replaces its canonical recipient allowlist.';

commit;
