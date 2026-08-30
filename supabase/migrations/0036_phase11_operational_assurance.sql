-- Phase 11: deterministic automation monitoring, incident response, and human go/no-go evidence.
-- This migration never activates n8n, changes environment variables, or sends outbound messages.

begin;

create table if not exists public.automation_monitoring_policies (
  workflow_key text primary key,
  lookback_hours integer not null,
  minimum_runs integer not null,
  maximum_failure_rate_percent numeric(5,2) not null,
  stale_running_minutes integer not null,
  maximum_consecutive_failures integer not null,
  enabled boolean not null default true,
  owner text,
  is_mock boolean not null default true,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_monitoring_policies_workflow_valid check (
    workflow_key in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor')
  ),
  constraint automation_monitoring_policies_lookback_valid check (lookback_hours between 1 and 168),
  constraint automation_monitoring_policies_minimum_runs_valid check (minimum_runs between 1 and 1000),
  constraint automation_monitoring_policies_failure_rate_valid check (maximum_failure_rate_percent between 0 and 100),
  constraint automation_monitoring_policies_stale_valid check (stale_running_minutes between 5 and 1440),
  constraint automation_monitoring_policies_consecutive_valid check (maximum_consecutive_failures between 1 and 20),
  constraint automation_monitoring_policies_owner_valid check (owner is null or length(btrim(owner)) between 3 and 320),
  constraint automation_monitoring_policies_version_valid check (version >= 1)
);

create table if not exists public.automation_monitoring_policy_events (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null references public.automation_monitoring_policies(workflow_key) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint automation_monitoring_policy_events_type_valid check (event_type in ('seeded', 'updated')),
  constraint automation_monitoring_policy_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists automation_monitoring_policy_events_workflow_idx
  on public.automation_monitoring_policy_events (workflow_key, created_at desc);

create table if not exists public.pilot_monitoring_snapshots (
  id uuid primary key default gen_random_uuid(),
  pilot_release_id uuid references public.pilot_release_plans(id) on delete set null,
  idempotency_key text not null unique,
  window_started_at timestamptz not null,
  window_ended_at timestamptz not null,
  evaluated_at timestamptz not null default now(),
  overall_status text not null,
  metrics jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  dry_run boolean not null default true,
  is_mock boolean not null default true,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint pilot_monitoring_snapshots_key_valid check (length(btrim(idempotency_key)) between 3 and 200),
  constraint pilot_monitoring_snapshots_window_valid check (window_ended_at >= window_started_at),
  constraint pilot_monitoring_snapshots_status_valid check (overall_status in ('healthy', 'warning', 'critical', 'insufficient_data')),
  constraint pilot_monitoring_snapshots_metrics_object check (jsonb_typeof(metrics) = 'object'),
  constraint pilot_monitoring_snapshots_findings_array check (jsonb_typeof(findings) = 'array'),
  constraint pilot_monitoring_snapshots_blockers_array check (jsonb_typeof(blockers) = 'array'),
  constraint pilot_monitoring_snapshots_actor_valid check (length(btrim(created_by)) between 3 and 320)
);

create index if not exists pilot_monitoring_snapshots_release_idx
  on public.pilot_monitoring_snapshots (pilot_release_id, evaluated_at desc);
create index if not exists pilot_monitoring_snapshots_status_idx
  on public.pilot_monitoring_snapshots (overall_status, evaluated_at desc);

create table if not exists public.automation_incidents (
  id uuid primary key default gen_random_uuid(),
  incident_key text not null unique,
  workflow_key text,
  pilot_release_id uuid references public.pilot_release_plans(id) on delete set null,
  severity text not null,
  status text not null default 'open',
  source_type text not null default 'watchdog',
  source_run_id uuid references public.automation_runs(id) on delete set null,
  title text not null,
  summary text not null,
  owner text,
  resolution_note text,
  detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  occurrence_count integer not null default 1,
  resolved_at timestamptz,
  resolved_by text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_incidents_key_valid check (length(btrim(incident_key)) between 3 and 200),
  constraint automation_incidents_workflow_valid check (
    workflow_key is null
    or workflow_key in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor')
  ),
  constraint automation_incidents_severity_valid check (severity in ('low', 'medium', 'high', 'critical')),
  constraint automation_incidents_status_valid check (status in ('open', 'investigating', 'monitoring', 'resolved', 'dismissed')),
  constraint automation_incidents_source_valid check (source_type in ('watchdog', 'manual', 'runtime', 'uat')),
  constraint automation_incidents_title_valid check (length(btrim(title)) between 3 and 200),
  constraint automation_incidents_summary_valid check (length(btrim(summary)) between 5 and 4000),
  constraint automation_incidents_occurrence_valid check (occurrence_count >= 1),
  constraint automation_incidents_owner_valid check (owner is null or length(btrim(owner)) between 3 and 320),
  constraint automation_incidents_resolution_valid check (
    status not in ('resolved', 'dismissed')
    or (
      owner is not null
      and resolution_note is not null and length(btrim(resolution_note)) >= 10
      and resolved_at is not null
      and resolved_by is not null
    )
  )
);

create index if not exists automation_incidents_status_idx
  on public.automation_incidents (status, severity, last_detected_at desc);
create index if not exists automation_incidents_release_idx
  on public.automation_incidents (pilot_release_id, status, last_detected_at desc);

create table if not exists public.automation_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.automation_incidents(id) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint automation_incident_events_type_valid check (
    event_type in ('created', 'detected_again', 'reopened', 'assigned', 'status_changed', 'severity_changed', 'resolved', 'dismissed')
  ),
  constraint automation_incident_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists automation_incident_events_incident_idx
  on public.automation_incident_events (incident_id, created_at desc);

create table if not exists public.pilot_go_no_go_reviews (
  id uuid primary key default gen_random_uuid(),
  pilot_release_id uuid not null unique references public.pilot_release_plans(id) on delete cascade,
  monitoring_snapshot_id uuid not null references public.pilot_monitoring_snapshots(id) on delete restrict,
  decision text not null,
  conditions jsonb not null default '[]'::jsonb,
  decision_note text not null,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_go_no_go_reviews_decision_valid check (decision in ('go', 'conditional_go', 'no_go')),
  constraint pilot_go_no_go_reviews_conditions_array check (jsonb_typeof(conditions) = 'array'),
  constraint pilot_go_no_go_reviews_note_valid check (length(btrim(decision_note)) between 10 and 4000),
  constraint pilot_go_no_go_reviews_actor_valid check (length(btrim(decided_by)) between 3 and 320),
  constraint pilot_go_no_go_reviews_version_valid check (version >= 1),
  constraint pilot_go_no_go_reviews_conditional_valid check (
    decision <> 'conditional_go' or jsonb_array_length(conditions) > 0
  )
);

create index if not exists pilot_go_no_go_reviews_decision_idx
  on public.pilot_go_no_go_reviews (decision, decided_at desc);

drop trigger if exists automation_monitoring_policies_set_updated_at on public.automation_monitoring_policies;
create trigger automation_monitoring_policies_set_updated_at
before update on public.automation_monitoring_policies
for each row execute function public.set_updated_at();

drop trigger if exists automation_incidents_set_updated_at on public.automation_incidents;
create trigger automation_incidents_set_updated_at
before update on public.automation_incidents
for each row execute function public.set_updated_at();

drop trigger if exists pilot_go_no_go_reviews_set_updated_at on public.pilot_go_no_go_reviews;
create trigger pilot_go_no_go_reviews_set_updated_at
before update on public.pilot_go_no_go_reviews
for each row execute function public.set_updated_at();

alter table public.automation_monitoring_policies enable row level security;
alter table public.automation_monitoring_policy_events enable row level security;
alter table public.pilot_monitoring_snapshots enable row level security;
alter table public.automation_incidents enable row level security;
alter table public.automation_incident_events enable row level security;
alter table public.pilot_go_no_go_reviews enable row level security;

revoke all on table
  public.automation_monitoring_policies,
  public.automation_monitoring_policy_events,
  public.pilot_monitoring_snapshots,
  public.automation_incidents,
  public.automation_incident_events,
  public.pilot_go_no_go_reviews
from public, anon, authenticated;

grant select, insert, update on table public.automation_monitoring_policies to service_role;
grant select, insert on table public.automation_monitoring_policy_events to service_role;
grant select, insert on table public.pilot_monitoring_snapshots to service_role;
grant select, insert, update on table public.automation_incidents to service_role;
grant select, insert on table public.automation_incident_events to service_role;
grant select, insert, update on table public.pilot_go_no_go_reviews to service_role;

insert into public.automation_monitoring_policies (
  workflow_key, lookback_hours, minimum_runs, maximum_failure_rate_percent,
  stale_running_minutes, maximum_consecutive_failures, enabled, owner, is_mock, updated_by
)
values
  ('follow_up_scheduler', 24, 1, 20, 30, 2, true, null, true, 'system-migration'),
  ('transformation_event_worker', 1, 1, 10, 10, 3, true, null, true, 'system-migration'),
  ('client_operations_daily', 36, 1, 20, 30, 2, true, null, true, 'system-migration'),
  ('acquisition_batch_processor', 36, 1, 20, 30, 2, true, null, true, 'system-migration')
on conflict (workflow_key) do nothing;

insert into public.automation_monitoring_policy_events (
  workflow_key, event_type, actor, after_snapshot, note
)
select
  policy.workflow_key,
  'seeded',
  'system-migration',
  to_jsonb(policy),
  'Policy monitoring konservatif Fase 11 dibuat sebagai mock dan wajib diberi owner sebelum keputusan go.'
from public.automation_monitoring_policies policy
where not exists (
  select 1 from public.automation_monitoring_policy_events event
  where event.workflow_key = policy.workflow_key and event.event_type = 'seeded'
);

create or replace function public.save_automation_monitoring_policy(
  p_workflow_key text,
  p_actor text,
  p_lookback_hours integer,
  p_minimum_runs integer,
  p_maximum_failure_rate_percent numeric,
  p_stale_running_minutes integer,
  p_maximum_consecutive_failures integer,
  p_enabled boolean,
  p_owner text,
  p_is_mock boolean
)
returns public.automation_monitoring_policies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.automation_monitoring_policies%rowtype;
  saved public.automation_monitoring_policies%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
begin
  if length(normalized_actor) < 3 then raise exception 'MONITORING_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_workflow_key not in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor') then
    raise exception 'MONITORING_WORKFLOW_INVALID' using errcode = '22023';
  end if;
  if p_lookback_hours not between 1 and 168
    or p_minimum_runs not between 1 and 1000
    or p_maximum_failure_rate_percent not between 0 and 100
    or p_stale_running_minutes not between 5 and 1440
    or p_maximum_consecutive_failures not between 1 and 20 then
    raise exception 'MONITORING_THRESHOLD_INVALID' using errcode = '22023';
  end if;
  if not coalesce(p_is_mock, true) and normalized_owner is null then
    raise exception 'MONITORING_OWNER_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record
  from public.automation_monitoring_policies
  where workflow_key = p_workflow_key
  for update;
  if before_record.workflow_key is null then raise exception 'MONITORING_POLICY_NOT_FOUND' using errcode = 'P0002'; end if;

  update public.automation_monitoring_policies
  set lookback_hours = p_lookback_hours,
      minimum_runs = p_minimum_runs,
      maximum_failure_rate_percent = p_maximum_failure_rate_percent,
      stale_running_minutes = p_stale_running_minutes,
      maximum_consecutive_failures = p_maximum_consecutive_failures,
      enabled = coalesce(p_enabled, true),
      owner = normalized_owner,
      is_mock = coalesce(p_is_mock, true),
      version = version + 1,
      updated_by = normalized_actor
  where workflow_key = p_workflow_key
  returning * into saved;

  insert into public.automation_monitoring_policy_events (
    workflow_key, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.workflow_key, 'updated', normalized_actor, to_jsonb(before_record), to_jsonb(saved),
    'Policy monitoring diperbarui melalui Operational Assurance.'
  );
  return saved;
end;
$$;

create or replace function public.record_pilot_monitoring_snapshot(
  p_release_id uuid,
  p_idempotency_key text,
  p_actor text,
  p_window_started_at timestamptz,
  p_window_ended_at timestamptz,
  p_overall_status text,
  p_metrics jsonb,
  p_findings jsonb,
  p_blockers jsonb,
  p_dry_run boolean,
  p_is_mock boolean
)
returns public.pilot_monitoring_snapshots
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved public.pilot_monitoring_snapshots%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_key text := btrim(coalesce(p_idempotency_key, ''));
begin
  if length(normalized_actor) < 3 then raise exception 'MONITORING_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if length(normalized_key) not between 3 and 200 then raise exception 'MONITORING_KEY_INVALID' using errcode = '22023'; end if;
  if p_window_started_at is null or p_window_ended_at is null or p_window_ended_at < p_window_started_at then
    raise exception 'MONITORING_WINDOW_INVALID' using errcode = '22023';
  end if;
  if p_overall_status not in ('healthy', 'warning', 'critical', 'insufficient_data') then
    raise exception 'MONITORING_STATUS_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_metrics, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_findings, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_blockers, '[]'::jsonb)) <> 'array' then
    raise exception 'MONITORING_PAYLOAD_INVALID' using errcode = '22023';
  end if;

  insert into public.pilot_monitoring_snapshots (
    pilot_release_id, idempotency_key, window_started_at, window_ended_at, evaluated_at,
    overall_status, metrics, findings, blockers, dry_run, is_mock, created_by
  ) values (
    p_release_id, normalized_key, p_window_started_at, p_window_ended_at, now(),
    p_overall_status, coalesce(p_metrics, '{}'::jsonb), coalesce(p_findings, '[]'::jsonb),
    coalesce(p_blockers, '[]'::jsonb), coalesce(p_dry_run, true), coalesce(p_is_mock, true), normalized_actor
  )
  on conflict (idempotency_key) do nothing
  returning * into saved;

  if saved.id is null then
    select * into saved from public.pilot_monitoring_snapshots where idempotency_key = normalized_key;
  end if;
  return saved;
end;
$$;

create or replace function public.upsert_automation_incident(
  p_incident_key text,
  p_workflow_key text,
  p_release_id uuid,
  p_severity text,
  p_title text,
  p_summary text,
  p_source_run_id uuid,
  p_actor text,
  p_source_type text default 'watchdog'
)
returns public.automation_incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.automation_incidents%rowtype;
  saved public.automation_incidents%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_key text := btrim(coalesce(p_incident_key, ''));
  next_status text;
  next_event text;
begin
  if length(normalized_actor) < 3 then raise exception 'INCIDENT_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if length(normalized_key) not between 3 and 200 then raise exception 'INCIDENT_KEY_INVALID' using errcode = '22023'; end if;
  if p_workflow_key is not null and p_workflow_key not in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor') then
    raise exception 'INCIDENT_WORKFLOW_INVALID' using errcode = '22023';
  end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then raise exception 'INCIDENT_SEVERITY_INVALID' using errcode = '22023'; end if;
  if p_source_type not in ('watchdog', 'manual', 'runtime', 'uat') then raise exception 'INCIDENT_SOURCE_INVALID' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 or length(btrim(coalesce(p_summary, ''))) < 5 then
    raise exception 'INCIDENT_DESCRIPTION_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record from public.automation_incidents where incident_key = normalized_key for update;
  if before_record.id is null then
    insert into public.automation_incidents (
      incident_key, workflow_key, pilot_release_id, severity, status, source_type,
      source_run_id, title, summary, created_by, updated_by
    ) values (
      normalized_key, p_workflow_key, p_release_id, p_severity, 'open', p_source_type,
      p_source_run_id, btrim(p_title), btrim(p_summary), normalized_actor, normalized_actor
    ) returning * into saved;
    next_event := 'created';
  else
    next_status := case when before_record.status in ('resolved', 'dismissed') then 'open' else before_record.status end;
    update public.automation_incidents
    set pilot_release_id = coalesce(p_release_id, pilot_release_id),
        severity = case
          when p_severity = 'critical' then 'critical'
          when p_severity = 'high' and severity in ('low', 'medium', 'high') then 'high'
          when p_severity = 'medium' and severity in ('low', 'medium') then 'medium'
          else severity
        end,
        status = next_status,
        source_run_id = coalesce(p_source_run_id, source_run_id),
        title = btrim(p_title),
        summary = btrim(p_summary),
        last_detected_at = now(),
        occurrence_count = occurrence_count + 1,
        resolution_note = case when next_status = 'open' then null else resolution_note end,
        resolved_at = case when next_status = 'open' then null else resolved_at end,
        resolved_by = case when next_status = 'open' then null else resolved_by end,
        updated_by = normalized_actor
    where id = before_record.id
    returning * into saved;
    next_event := case when before_record.status in ('resolved', 'dismissed') then 'reopened' else 'detected_again' end;
  end if;

  insert into public.automation_incident_events (
    incident_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id, next_event, normalized_actor, coalesce(to_jsonb(before_record), '{}'::jsonb), to_jsonb(saved),
    'Finding deterministik terdeteksi oleh Operational Assurance watchdog.'
  );
  return saved;
end;
$$;

create or replace function public.update_automation_incident(
  p_incident_id uuid,
  p_actor text,
  p_status text,
  p_severity text,
  p_owner text,
  p_resolution_note text
)
returns public.automation_incidents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.automation_incidents%rowtype;
  saved public.automation_incidents%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
  normalized_resolution text := nullif(btrim(coalesce(p_resolution_note, '')), '');
  next_event text;
begin
  if length(normalized_actor) < 3 then raise exception 'INCIDENT_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_status not in ('open', 'investigating', 'monitoring', 'resolved', 'dismissed') then raise exception 'INCIDENT_STATUS_INVALID' using errcode = '22023'; end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then raise exception 'INCIDENT_SEVERITY_INVALID' using errcode = '22023'; end if;
  if p_status in ('investigating', 'monitoring', 'resolved', 'dismissed') and normalized_owner is null then
    raise exception 'INCIDENT_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_status in ('resolved', 'dismissed') and coalesce(length(normalized_resolution), 0) < 10 then
    raise exception 'INCIDENT_RESOLUTION_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record from public.automation_incidents where id = p_incident_id for update;
  if before_record.id is null then raise exception 'INCIDENT_NOT_FOUND' using errcode = 'P0002'; end if;
  next_event := case
    when p_status = 'resolved' then 'resolved'
    when p_status = 'dismissed' then 'dismissed'
    when before_record.status is distinct from p_status then 'status_changed'
    when before_record.severity is distinct from p_severity then 'severity_changed'
    else 'assigned'
  end;

  update public.automation_incidents
  set status = p_status,
      severity = p_severity,
      owner = normalized_owner,
      resolution_note = case when p_status in ('resolved', 'dismissed') then normalized_resolution else null end,
      resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
      resolved_by = case when p_status in ('resolved', 'dismissed') then normalized_actor else null end,
      updated_by = normalized_actor
  where id = p_incident_id
  returning * into saved;

  insert into public.automation_incident_events (
    incident_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id, next_event, normalized_actor, to_jsonb(before_record), to_jsonb(saved),
    coalesce(normalized_resolution, 'Incident response diperbarui oleh manusia.')
  );
  return saved;
end;
$$;

alter table public.pilot_release_events drop constraint if exists pilot_release_events_type_valid;
alter table public.pilot_release_events add constraint pilot_release_events_type_valid check (
  event_type in (
    'created', 'plan_updated', 'review_requested', 'approved', 'rejected',
    'scheduled', 'paused', 'rolled_back', 'completed', 'operational_review_recorded'
  )
);

create or replace function public.record_pilot_go_no_go_review(
  p_release_id uuid,
  p_snapshot_id uuid,
  p_actor text,
  p_decision text,
  p_conditions jsonb,
  p_decision_note text
)
returns public.pilot_go_no_go_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  release_record public.pilot_release_plans%rowtype;
  snapshot_record public.pilot_monitoring_snapshots%rowtype;
  before_record public.pilot_go_no_go_reviews%rowtype;
  saved public.pilot_go_no_go_reviews%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_note text := btrim(coalesce(p_decision_note, ''));
  normalized_conditions jsonb := coalesce(p_conditions, '[]'::jsonb);
begin
  if length(normalized_actor) < 3 then raise exception 'GO_NO_GO_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_decision not in ('go', 'conditional_go', 'no_go') then raise exception 'GO_NO_GO_DECISION_INVALID' using errcode = '22023'; end if;
  if length(normalized_note) < 10 then raise exception 'GO_NO_GO_NOTE_REQUIRED' using errcode = '22023'; end if;
  if jsonb_typeof(normalized_conditions) <> 'array' then raise exception 'GO_NO_GO_CONDITIONS_INVALID' using errcode = '22023'; end if;
  if p_decision = 'conditional_go' and jsonb_array_length(normalized_conditions) = 0 then
    raise exception 'GO_NO_GO_CONDITIONS_REQUIRED' using errcode = '22023';
  end if;

  select * into release_record from public.pilot_release_plans where id = p_release_id for update;
  if release_record.id is null then raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002'; end if;
  if release_record.is_mock or release_record.status not in ('approved', 'scheduled') then
    raise exception 'GO_NO_GO_APPROVED_RELEASE_REQUIRED' using errcode = '55000';
  end if;
  select * into snapshot_record from public.pilot_monitoring_snapshots where id = p_snapshot_id;
  if snapshot_record.id is null or snapshot_record.pilot_release_id is distinct from release_record.id then
    raise exception 'GO_NO_GO_SNAPSHOT_INVALID' using errcode = '55000';
  end if;

  if p_decision in ('go', 'conditional_go') then
    if snapshot_record.is_mock or snapshot_record.evaluated_at < now() - interval '24 hours' then
      raise exception 'GO_NO_GO_FRESH_REAL_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_monitoring_policies
      where not enabled or is_mock or owner is null
    ) or (select count(*) from public.automation_monitoring_policies) <> 4 then
      raise exception 'GO_NO_GO_REAL_POLICIES_REQUIRED' using errcode = '55000';
    end if;
    if exists (select 1 from public.uat_scenarios where required and status <> 'passed') then
      raise exception 'GO_NO_GO_UAT_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed')
        and severity = 'critical'
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then
      raise exception 'GO_NO_GO_CRITICAL_INCIDENT_OPEN' using errcode = '55000';
    end if;
  end if;

  if p_decision = 'go' then
    if snapshot_record.overall_status <> 'healthy' or jsonb_array_length(snapshot_record.blockers) > 0 then
      raise exception 'GO_NO_GO_HEALTHY_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed')
        and severity in ('high', 'critical')
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then
      raise exception 'GO_NO_GO_HIGH_INCIDENT_OPEN' using errcode = '55000';
    end if;
  elsif p_decision = 'conditional_go' then
    if snapshot_record.overall_status not in ('healthy', 'warning')
      or exists (
        select 1 from jsonb_array_elements(snapshot_record.findings) finding
        where finding->>'severity' = 'critical'
      ) then
      raise exception 'GO_NO_GO_CONDITIONAL_SNAPSHOT_INVALID' using errcode = '55000';
    end if;
  end if;

  select * into before_record from public.pilot_go_no_go_reviews where pilot_release_id = release_record.id;
  insert into public.pilot_go_no_go_reviews (
    pilot_release_id, monitoring_snapshot_id, decision, conditions, decision_note,
    decided_by, decided_at, version
  ) values (
    release_record.id, snapshot_record.id, p_decision, normalized_conditions, normalized_note,
    normalized_actor, now(), 1
  )
  on conflict (pilot_release_id) do update
  set monitoring_snapshot_id = excluded.monitoring_snapshot_id,
      decision = excluded.decision,
      conditions = excluded.conditions,
      decision_note = excluded.decision_note,
      decided_by = excluded.decided_by,
      decided_at = excluded.decided_at,
      version = public.pilot_go_no_go_reviews.version + 1
  returning * into saved;

  insert into public.pilot_release_events (
    release_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    release_record.id, 'operational_review_recorded', normalized_actor,
    coalesce(to_jsonb(before_record), '{}'::jsonb), to_jsonb(saved), normalized_note
  );
  return saved;
end;
$$;

create or replace function public.enforce_phase11_pilot_schedule_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  review_decision text;
begin
  if new.status = 'scheduled' and old.status is distinct from new.status then
    select review.decision into review_decision
    from public.pilot_go_no_go_reviews review
    join public.pilot_monitoring_snapshots snapshot
      on snapshot.id = review.monitoring_snapshot_id
    where review.pilot_release_id = new.id
      and review.decision in ('go', 'conditional_go')
      and snapshot.is_mock = false
      and snapshot.evaluated_at >= now() - interval '24 hours';
    if review_decision is null then
      raise exception 'PILOT_OPERATIONAL_REVIEW_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_monitoring_policies
      where not enabled or is_mock or owner is null
    ) or (select count(*) from public.automation_monitoring_policies) <> 4 then
      raise exception 'PILOT_MONITORING_POLICY_NOT_READY' using errcode = '55000';
    end if;
    if exists (select 1 from public.uat_scenarios where required and status <> 'passed') then
      raise exception 'PILOT_UAT_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents incident
      where incident.status not in ('resolved', 'dismissed')
        and incident.severity = 'critical'
        and (incident.pilot_release_id is null or incident.pilot_release_id = new.id)
    ) then
      raise exception 'PILOT_CRITICAL_INCIDENT_OPEN' using errcode = '55000';
    end if;
    if review_decision = 'go' and exists (
      select 1 from public.automation_incidents incident
      where incident.status not in ('resolved', 'dismissed')
        and incident.severity = 'high'
        and (incident.pilot_release_id is null or incident.pilot_release_id = new.id)
    ) then
      raise exception 'PILOT_HIGH_INCIDENT_OPEN' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pilot_release_plans_phase11_schedule_gate on public.pilot_release_plans;
create trigger pilot_release_plans_phase11_schedule_gate
before update on public.pilot_release_plans
for each row execute function public.enforce_phase11_pilot_schedule_gate();

create or replace function public.enforce_phase11_runtime_operational_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  review_decision text;
begin
  if new.requested_mode in ('pilot', 'live')
    and (
      old.requested_mode is distinct from new.requested_mode
      or old.pilot_release_id is distinct from new.pilot_release_id
    ) then
    select review.decision into review_decision
    from public.pilot_go_no_go_reviews review
    join public.pilot_monitoring_snapshots snapshot
      on snapshot.id = review.monitoring_snapshot_id
    where review.pilot_release_id = new.pilot_release_id
      and snapshot.is_mock = false
      and snapshot.evaluated_at >= now() - interval '24 hours';
    if new.requested_mode = 'pilot' and coalesce(review_decision, '') not in ('go', 'conditional_go') then
      raise exception 'RUNTIME_OPERATIONAL_REVIEW_REQUIRED' using errcode = '55000';
    end if;
    if new.requested_mode = 'live' and coalesce(review_decision, '') <> 'go' then
      raise exception 'RUNTIME_GO_DECISION_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_monitoring_policies
      where not enabled or is_mock or owner is null
    ) or (select count(*) from public.automation_monitoring_policies) <> 4 then
      raise exception 'RUNTIME_MONITORING_POLICY_NOT_READY' using errcode = '55000';
    end if;
    if exists (select 1 from public.uat_scenarios where required and status <> 'passed') then
      raise exception 'RUNTIME_UAT_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents incident
      where incident.status not in ('resolved', 'dismissed')
        and incident.severity = 'critical'
        and (incident.pilot_release_id is null or incident.pilot_release_id = new.pilot_release_id)
    ) then
      raise exception 'RUNTIME_CRITICAL_INCIDENT_OPEN' using errcode = '55000';
    end if;
    if new.requested_mode = 'live' and exists (
      select 1 from public.automation_incidents incident
      where incident.status not in ('resolved', 'dismissed')
        and incident.severity = 'high'
        and (incident.pilot_release_id is null or incident.pilot_release_id = new.pilot_release_id)
    ) then
      raise exception 'RUNTIME_HIGH_INCIDENT_OPEN' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists automation_runtime_controls_phase11_operational_gate on public.automation_runtime_controls;
create trigger automation_runtime_controls_phase11_operational_gate
before update on public.automation_runtime_controls
for each row execute function public.enforce_phase11_runtime_operational_gate();

revoke all on function public.save_automation_monitoring_policy(text,text,integer,integer,numeric,integer,integer,boolean,text,boolean)
  from public, anon, authenticated;
revoke all on function public.record_pilot_monitoring_snapshot(uuid,text,text,timestamptz,timestamptz,text,jsonb,jsonb,jsonb,boolean,boolean)
  from public, anon, authenticated;
revoke all on function public.upsert_automation_incident(text,text,uuid,text,text,text,uuid,text,text)
  from public, anon, authenticated;
revoke all on function public.update_automation_incident(uuid,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.record_pilot_go_no_go_review(uuid,uuid,text,text,jsonb,text)
  from public, anon, authenticated;

grant execute on function public.save_automation_monitoring_policy(text,text,integer,integer,numeric,integer,integer,boolean,text,boolean)
  to service_role;
grant execute on function public.record_pilot_monitoring_snapshot(uuid,text,text,timestamptz,timestamptz,text,jsonb,jsonb,jsonb,boolean,boolean)
  to service_role;
grant execute on function public.upsert_automation_incident(text,text,uuid,text,text,text,uuid,text,text)
  to service_role;
grant execute on function public.update_automation_incident(uuid,text,text,text,text,text)
  to service_role;
grant execute on function public.record_pilot_go_no_go_review(uuid,uuid,text,text,jsonb,text)
  to service_role;

comment on table public.pilot_monitoring_snapshots is
  'Deterministic operational evidence. A snapshot never activates workflows or sends outbound messages.';
comment on table public.pilot_go_no_go_reviews is
  'Human go/no-go decision bound to a fresh monitoring snapshot, UAT evidence, real policies, and incident state.';

commit;
