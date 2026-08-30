-- Phase 10: controlled pilot operations, audited runtime modes, and kill switch.
-- Database controls can only restrict execution. n8n activation and environment changes remain external human actions.

begin;

create table if not exists public.pilot_release_plans (
  id uuid primary key default gen_random_uuid(),
  release_key text not null unique,
  title text not null,
  status text not null default 'draft',
  cohort_description text not null,
  maximum_participants integer not null default 5,
  starts_at timestamptz,
  ends_at timestamptz,
  business_owner text,
  technical_owner text,
  monitoring_owner text,
  success_criteria jsonb not null default '[]'::jsonb,
  rollback_triggers jsonb not null default '[]'::jsonb,
  rollback_plan text,
  decision_note text,
  approved_by text,
  approved_at timestamptz,
  is_mock boolean not null default true,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_release_plans_key_valid check (
    release_key = lower(btrim(release_key))
    and release_key ~ '^[a-z][a-z0-9_-]{2,79}$'
  ),
  constraint pilot_release_plans_status_valid check (
    status in ('draft', 'review_requested', 'approved', 'rejected', 'scheduled', 'paused', 'rolled_back', 'completed')
  ),
  constraint pilot_release_plans_participants_valid check (maximum_participants between 1 and 10000),
  constraint pilot_release_plans_dates_valid check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint pilot_release_plans_success_array check (jsonb_typeof(success_criteria) = 'array'),
  constraint pilot_release_plans_rollback_array check (jsonb_typeof(rollback_triggers) = 'array'),
  constraint pilot_release_plans_approval_valid check (
    status not in ('approved', 'scheduled', 'paused', 'rolled_back', 'completed')
    or (
      is_mock = false
      and business_owner is not null
      and technical_owner is not null
      and monitoring_owner is not null
      and rollback_plan is not null and length(btrim(rollback_plan)) >= 10
      and jsonb_array_length(success_criteria) > 0
      and jsonb_array_length(rollback_triggers) > 0
      and decision_note is not null and length(btrim(decision_note)) >= 10
      and approved_by is not null
      and approved_at is not null
    )
  )
);

create index if not exists pilot_release_plans_status_idx
  on public.pilot_release_plans (status, updated_at desc);

create table if not exists public.pilot_release_events (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.pilot_release_plans(id) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint pilot_release_events_type_valid check (
    event_type in ('created', 'plan_updated', 'review_requested', 'approved', 'rejected', 'scheduled', 'paused', 'rolled_back', 'completed')
  ),
  constraint pilot_release_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists pilot_release_events_release_idx
  on public.pilot_release_events (release_id, created_at desc);

create table if not exists public.automation_runtime_controls (
  workflow_key text primary key,
  requested_mode text not null default 'dry_run',
  maximum_items_per_run integer not null default 10,
  pilot_release_id uuid references public.pilot_release_plans(id) on delete set null,
  owner text,
  approval_note text,
  approved_by text,
  approved_at timestamptz,
  rollback_plan text,
  kill_switch_reason text,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automation_runtime_controls_workflow_valid check (
    workflow_key in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor')
  ),
  constraint automation_runtime_controls_mode_valid check (requested_mode in ('disabled', 'dry_run', 'pilot', 'live')),
  constraint automation_runtime_controls_limit_valid check (maximum_items_per_run between 1 and 500),
  constraint automation_runtime_controls_version_valid check (version >= 1),
  constraint automation_runtime_controls_activation_valid check (
    requested_mode not in ('pilot', 'live')
    or (
      pilot_release_id is not null
      and owner is not null
      and approval_note is not null and length(btrim(approval_note)) >= 10
      and approved_by is not null
      and approved_at is not null
      and rollback_plan is not null and length(btrim(rollback_plan)) >= 10
    )
  ),
  constraint automation_runtime_controls_disabled_valid check (
    requested_mode <> 'disabled'
    or (kill_switch_reason is not null and length(btrim(kill_switch_reason)) >= 5)
  )
);

create table if not exists public.automation_runtime_control_events (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null references public.automation_runtime_controls(workflow_key) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint automation_runtime_control_events_type_valid check (
    event_type in ('seeded', 'mode_changed', 'limit_changed', 'kill_switch_engaged')
  ),
  constraint automation_runtime_control_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists automation_runtime_control_events_workflow_idx
  on public.automation_runtime_control_events (workflow_key, created_at desc);

drop trigger if exists pilot_release_plans_set_updated_at on public.pilot_release_plans;
create trigger pilot_release_plans_set_updated_at
before update on public.pilot_release_plans
for each row execute function public.set_updated_at();

drop trigger if exists automation_runtime_controls_set_updated_at on public.automation_runtime_controls;
create trigger automation_runtime_controls_set_updated_at
before update on public.automation_runtime_controls
for each row execute function public.set_updated_at();

alter table public.pilot_release_plans enable row level security;
alter table public.pilot_release_events enable row level security;
alter table public.automation_runtime_controls enable row level security;
alter table public.automation_runtime_control_events enable row level security;

revoke all on table
  public.pilot_release_plans,
  public.pilot_release_events,
  public.automation_runtime_controls,
  public.automation_runtime_control_events
from public, anon, authenticated;

grant select, insert, update on table public.pilot_release_plans to service_role;
grant select, insert on table public.pilot_release_events to service_role;
grant select, insert, update on table public.automation_runtime_controls to service_role;
grant select, insert on table public.automation_runtime_control_events to service_role;

insert into public.automation_runtime_controls (
  workflow_key, requested_mode, maximum_items_per_run, owner, approval_note, updated_by
)
values
  ('follow_up_scheduler', 'dry_run', 20, null, 'Default aman Fase 10: hanya dry-run.', 'system-migration'),
  ('transformation_event_worker', 'dry_run', 10, null, 'Default aman Fase 10: hanya dry-run.', 'system-migration'),
  ('client_operations_daily', 'dry_run', 100, null, 'Default aman Fase 10: hanya dry-run.', 'system-migration'),
  ('acquisition_batch_processor', 'dry_run', 25, null, 'Default aman Fase 10: hanya dry-run.', 'system-migration')
on conflict (workflow_key) do nothing;

insert into public.automation_runtime_control_events (
  workflow_key, event_type, actor, after_snapshot, note
)
select
  control.workflow_key,
  'seeded',
  'system-migration',
  jsonb_build_object(
    'requestedMode', control.requested_mode,
    'maximumItemsPerRun', control.maximum_items_per_run,
    'version', control.version
  ),
  'Runtime control Fase 10 dimulai dalam mode dry-run.'
from public.automation_runtime_controls control
where not exists (
  select 1 from public.automation_runtime_control_events event
  where event.workflow_key = control.workflow_key and event.event_type = 'seeded'
);

create or replace function public.save_pilot_release_plan(
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
  p_is_mock boolean
)
returns public.pilot_release_plans
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_key text := lower(btrim(coalesce(p_release_key, '')));
  saved public.pilot_release_plans%rowtype;
  before_record public.pilot_release_plans%rowtype;
  next_event_type text := 'created';
begin
  if length(normalized_actor) < 3 then
    raise exception 'PILOT_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if normalized_key !~ '^[a-z][a-z0-9_-]{2,79}$' then
    raise exception 'PILOT_RELEASE_KEY_INVALID' using errcode = '22023';
  end if;
  if coalesce(length(btrim(p_title)), 0) < 3 or coalesce(length(btrim(p_cohort_description)), 0) < 10 then
    raise exception 'PILOT_PLAN_DESCRIPTION_REQUIRED' using errcode = '22023';
  end if;
  if p_maximum_participants not between 1 and 10000 then
    raise exception 'PILOT_MAXIMUM_PARTICIPANTS_INVALID' using errcode = '22023';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    raise exception 'PILOT_DATE_RANGE_INVALID' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_success_criteria, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_rollback_triggers, '[]'::jsonb)) <> 'array' then
    raise exception 'PILOT_CRITERIA_MUST_BE_ARRAY' using errcode = '22023';
  end if;

  if p_release_id is not null then
    select * into before_record
    from public.pilot_release_plans
    where id = p_release_id
    for update;
    if before_record.id is null then
      raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002';
    end if;
    if before_record.status not in ('draft', 'rejected') then
      raise exception 'PILOT_RELEASE_LOCKED_FOR_EDIT' using errcode = '55000';
    end if;

    update public.pilot_release_plans
    set release_key = normalized_key,
        title = btrim(p_title),
        cohort_description = btrim(p_cohort_description),
        maximum_participants = p_maximum_participants,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        business_owner = nullif(lower(btrim(coalesce(p_business_owner, ''))), ''),
        technical_owner = nullif(lower(btrim(coalesce(p_technical_owner, ''))), ''),
        monitoring_owner = nullif(lower(btrim(coalesce(p_monitoring_owner, ''))), ''),
        success_criteria = coalesce(p_success_criteria, '[]'::jsonb),
        rollback_triggers = coalesce(p_rollback_triggers, '[]'::jsonb),
        rollback_plan = nullif(btrim(coalesce(p_rollback_plan, '')), ''),
        is_mock = coalesce(p_is_mock, true),
        status = case when status = 'rejected' then 'draft' else status end,
        decision_note = null,
        approved_by = null,
        approved_at = null,
        updated_by = normalized_actor
    where id = p_release_id
    returning * into saved;
    next_event_type := 'plan_updated';
  else
    insert into public.pilot_release_plans (
      release_key, title, cohort_description, maximum_participants, starts_at, ends_at,
      business_owner, technical_owner, monitoring_owner, success_criteria,
      rollback_triggers, rollback_plan, is_mock, created_by, updated_by
    ) values (
      normalized_key, btrim(p_title), btrim(p_cohort_description), p_maximum_participants,
      p_starts_at, p_ends_at,
      nullif(lower(btrim(coalesce(p_business_owner, ''))), ''),
      nullif(lower(btrim(coalesce(p_technical_owner, ''))), ''),
      nullif(lower(btrim(coalesce(p_monitoring_owner, ''))), ''),
      coalesce(p_success_criteria, '[]'::jsonb),
      coalesce(p_rollback_triggers, '[]'::jsonb),
      nullif(btrim(coalesce(p_rollback_plan, '')), ''),
      coalesce(p_is_mock, true), normalized_actor, normalized_actor
    ) returning * into saved;
  end if;

  insert into public.pilot_release_events (
    release_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id,
    next_event_type,
    normalized_actor,
    case when before_record.id is null then '{}'::jsonb else jsonb_build_object('status', before_record.status, 'isMock', before_record.is_mock) end,
    jsonb_build_object('status', saved.status, 'isMock', saved.is_mock, 'maximumParticipants', saved.maximum_participants),
    'Pilot release plan disimpan; tidak ada workflow yang diaktifkan.'
  );

  return saved;
end;
$$;

create or replace function public.transition_pilot_release_plan(
  p_release_id uuid,
  p_actor text,
  p_next_status text,
  p_decision_note text
)
returns public.pilot_release_plans
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.pilot_release_plans%rowtype;
  saved public.pilot_release_plans%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_note text := nullif(btrim(coalesce(p_decision_note, '')), '');
  valid_transition boolean := false;
  required_total integer;
  required_passed integer;
  approved_templates integer;
  business_ready boolean;
begin
  if length(normalized_actor) < 3 then
    raise exception 'PILOT_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_next_status not in ('review_requested', 'approved', 'rejected', 'scheduled', 'paused', 'rolled_back', 'completed') then
    raise exception 'PILOT_STATUS_INVALID' using errcode = '22023';
  end if;
  if coalesce(length(normalized_note), 0) < 10 then
    raise exception 'PILOT_DECISION_NOTE_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record
  from public.pilot_release_plans
  where id = p_release_id
  for update;
  if before_record.id is null then
    raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002';
  end if;

  valid_transition :=
    (before_record.status = 'draft' and p_next_status = 'review_requested')
    or (before_record.status = 'review_requested' and p_next_status in ('approved', 'rejected'))
    or (before_record.status = 'approved' and p_next_status in ('scheduled', 'paused'))
    or (before_record.status = 'scheduled' and p_next_status in ('paused', 'rolled_back', 'completed'))
    or (before_record.status = 'paused' and p_next_status in ('scheduled', 'rolled_back', 'completed'));
  if not valid_transition then
    raise exception 'PILOT_STATUS_TRANSITION_INVALID' using errcode = '22023';
  end if;

  if p_next_status in ('review_requested', 'approved', 'scheduled') then
    if before_record.is_mock
      or before_record.business_owner is null
      or before_record.technical_owner is null
      or before_record.monitoring_owner is null
      or coalesce(length(btrim(before_record.rollback_plan)), 0) < 10
      or jsonb_array_length(before_record.success_criteria) = 0
      or jsonb_array_length(before_record.rollback_triggers) = 0 then
      raise exception 'PILOT_PLAN_INCOMPLETE' using errcode = '22023';
    end if;
  end if;

  if p_next_status = 'approved' then
    select count(*), count(*) filter (where status = 'passed')
    into required_total, required_passed
    from public.uat_scenarios
    where required;
    if required_total < 12 or required_passed <> required_total then
      raise exception 'PILOT_UAT_INCOMPLETE' using errcode = '55000';
    end if;

    select count(distinct template_key || ':' || locale)
    into approved_templates
    from public.outreach_templates
    where status = 'approved' and is_mock = false;
    if approved_templates < 18 then
      raise exception 'PILOT_TEMPLATES_INCOMPLETE' using errcode = '55000';
    end if;

    select exists (
      select 1 from public.business_rule_sets
      where status = 'active'
        and is_mock = false
        and coalesce((rules #>> '{activation,outboundAutomationEnabled}')::boolean, false)
        and jsonb_array_length(coalesce(rules #> '{activation,blockers}', '[]'::jsonb)) = 0
    ) into business_ready;
    if not business_ready then
      raise exception 'PILOT_BUSINESS_RULES_INCOMPLETE' using errcode = '55000';
    end if;
  end if;

  if p_next_status in ('paused', 'rolled_back', 'completed') and exists (
    select 1
    from public.automation_runtime_controls control
    where control.pilot_release_id = before_record.id
      and control.requested_mode in ('pilot', 'live')
  ) then
    raise exception 'PILOT_RUNTIME_CONTROLS_ACTIVE' using errcode = '55000';
  end if;

  update public.pilot_release_plans
  set status = p_next_status,
      decision_note = normalized_note,
      approved_by = case when p_next_status = 'approved' then normalized_actor else approved_by end,
      approved_at = case when p_next_status = 'approved' then now() else approved_at end,
      updated_by = normalized_actor
  where id = p_release_id
  returning * into saved;

  insert into public.pilot_release_events (
    release_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id,
    p_next_status,
    normalized_actor,
    jsonb_build_object('status', before_record.status),
    jsonb_build_object('status', saved.status),
    normalized_note
  );

  return saved;
end;
$$;

create or replace function public.set_automation_runtime_control(
  p_workflow_key text,
  p_actor text,
  p_requested_mode text,
  p_maximum_items_per_run integer,
  p_owner text,
  p_release_id uuid,
  p_human_approved boolean,
  p_approval_note text,
  p_rollback_plan text,
  p_kill_switch_reason text
)
returns public.automation_runtime_controls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.automation_runtime_controls%rowtype;
  saved public.automation_runtime_controls%rowtype;
  release_record public.pilot_release_plans%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
  normalized_note text := nullif(btrim(coalesce(p_approval_note, '')), '');
  normalized_rollback text := nullif(btrim(coalesce(p_rollback_plan, '')), '');
  normalized_kill_reason text := nullif(btrim(coalesce(p_kill_switch_reason, '')), '');
  next_event_type text;
begin
  if length(normalized_actor) < 3 then raise exception 'RUNTIME_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_workflow_key not in ('follow_up_scheduler', 'transformation_event_worker', 'client_operations_daily', 'acquisition_batch_processor') then
    raise exception 'RUNTIME_WORKFLOW_INVALID' using errcode = '22023';
  end if;
  if p_requested_mode not in ('disabled', 'dry_run', 'pilot', 'live') then
    raise exception 'RUNTIME_MODE_INVALID' using errcode = '22023';
  end if;
  if p_maximum_items_per_run not between 1 and 500 then
    raise exception 'RUNTIME_LIMIT_INVALID' using errcode = '22023';
  end if;
  if p_requested_mode = 'disabled' and coalesce(length(normalized_kill_reason), 0) < 5 then
    raise exception 'RUNTIME_KILL_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record
  from public.automation_runtime_controls
  where workflow_key = p_workflow_key
  for update;
  if before_record.workflow_key is null then
    raise exception 'RUNTIME_CONTROL_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_requested_mode in ('pilot', 'live') then
    if not coalesce(p_human_approved, false)
      or normalized_owner is null
      or coalesce(length(normalized_note), 0) < 10
      or coalesce(length(normalized_rollback), 0) < 10
      or p_release_id is null then
      raise exception 'RUNTIME_HUMAN_APPROVAL_REQUIRED' using errcode = '55000';
    end if;
    select * into release_record
    from public.pilot_release_plans
    where id = p_release_id and status in ('approved', 'scheduled') and is_mock = false;
    if release_record.id is null then
      raise exception 'RUNTIME_APPROVED_RELEASE_REQUIRED' using errcode = '55000';
    end if;
    if p_requested_mode = 'live' and release_record.status <> 'scheduled' then
      raise exception 'RUNTIME_SCHEDULED_RELEASE_REQUIRED' using errcode = '55000';
    end if;
  end if;

  next_event_type := case
    when p_requested_mode = 'disabled' then 'kill_switch_engaged'
    when before_record.requested_mode is distinct from p_requested_mode then 'mode_changed'
    else 'limit_changed'
  end;

  update public.automation_runtime_controls
  set requested_mode = p_requested_mode,
      maximum_items_per_run = p_maximum_items_per_run,
      pilot_release_id = case when p_requested_mode in ('pilot', 'live') then p_release_id else null end,
      owner = normalized_owner,
      approval_note = normalized_note,
      approved_by = case when p_requested_mode in ('pilot', 'live') then normalized_actor else null end,
      approved_at = case when p_requested_mode in ('pilot', 'live') then now() else null end,
      rollback_plan = normalized_rollback,
      kill_switch_reason = case when p_requested_mode = 'disabled' then normalized_kill_reason else null end,
      version = version + 1,
      updated_by = normalized_actor
  where workflow_key = p_workflow_key
  returning * into saved;

  insert into public.automation_runtime_control_events (
    workflow_key, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.workflow_key,
    next_event_type,
    normalized_actor,
    jsonb_build_object('requestedMode', before_record.requested_mode, 'maximumItemsPerRun', before_record.maximum_items_per_run, 'version', before_record.version),
    jsonb_build_object('requestedMode', saved.requested_mode, 'maximumItemsPerRun', saved.maximum_items_per_run, 'version', saved.version),
    coalesce(normalized_kill_reason, normalized_note, 'Runtime control diperbarui.')
  );

  return saved;
end;
$$;

create or replace function public.create_limited_client_operations_tasks(
  p_actor text,
  p_candidates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_actor text := btrim(coalesce(p_actor, ''));
  requested_total integer := 0;
  created_total integer := 0;
begin
  if length(normalized_actor) < 3 then
    raise exception 'AUTOMATION_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_candidates, '[]'::jsonb)) <> 'array' then
    raise exception 'AUTOMATION_CANDIDATES_ARRAY_REQUIRED' using errcode = '22023';
  end if;
  requested_total := jsonb_array_length(coalesce(p_candidates, '[]'::jsonb));
  if requested_total > 500 then
    raise exception 'AUTOMATION_CANDIDATE_LIMIT_EXCEEDED' using errcode = '22023';
  end if;

  with candidate as (
    select value, ordinality
    from jsonb_array_elements(coalesce(p_candidates, '[]'::jsonb)) with ordinality
  ), inserted as (
    insert into public.operational_tasks (
      task_key, task_type, title, description, priority, status, assigned_to,
      due_at, sla_policy_key, client_account_id, project_id, milestone_id,
      retention_opportunity_id, source_event_at, metadata, created_by, updated_by
    )
    select
      nullif(btrim(candidate.value->>'taskKey'), ''),
      nullif(btrim(candidate.value->>'taskType'), ''),
      nullif(btrim(candidate.value->>'title'), ''),
      'Tugas terkontrol dari Client Operations Scheduler: ' || nullif(btrim(candidate.value->>'title'), ''),
      coalesce(nullif(btrim(candidate.value->>'priority'), ''), 'medium'),
      'open',
      nullif(lower(btrim(candidate.value->>'assignedTo')), ''),
      nullif(candidate.value->>'dueAt', '')::timestamptz,
      nullif(btrim(candidate.value->>'taskType'), ''),
      nullif(candidate.value->>'clientAccountId', '')::uuid,
      nullif(candidate.value->>'projectId', '')::uuid,
      nullif(candidate.value->>'milestoneId', '')::uuid,
      nullif(candidate.value->>'retentionOpportunityId', '')::uuid,
      now(),
      coalesce(candidate.value->'metadata', '{}'::jsonb),
      normalized_actor,
      normalized_actor
    from candidate
    where coalesce(length(btrim(candidate.value->>'taskKey')), 0) >= 3
      and coalesce(length(btrim(candidate.value->>'taskType')), 0) >= 3
      and coalesce(length(btrim(candidate.value->>'title')), 0) >= 3
    order by candidate.ordinality
    on conflict (task_key) do nothing
    returning id, created_by
  )
  insert into public.operational_task_events (task_id, event_type, actor, after_snapshot, note)
  select id, 'created_by_automation', created_by, jsonb_build_object('status', 'open'),
    'Tugas dibuat oleh Client Operations Scheduler dengan runtime ceiling Fase 10.'
  from inserted;

  get diagnostics created_total = row_count;
  return jsonb_build_object(
    'success', true,
    'requestedCount', requested_total,
    'createdCount', created_total
  );
end;
$$;

revoke all on function public.save_pilot_release_plan(uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean)
from public, anon, authenticated;
revoke all on function public.transition_pilot_release_plan(uuid,text,text,text)
from public, anon, authenticated;
revoke all on function public.set_automation_runtime_control(text,text,text,integer,text,uuid,boolean,text,text,text)
from public, anon, authenticated;
revoke all on function public.create_limited_client_operations_tasks(text,jsonb)
from public, anon, authenticated;

grant execute on function public.save_pilot_release_plan(uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean)
to service_role;
grant execute on function public.transition_pilot_release_plan(uuid,text,text,text)
to service_role;
grant execute on function public.set_automation_runtime_control(text,text,text,integer,text,uuid,boolean,text,text,text)
to service_role;
grant execute on function public.create_limited_client_operations_tasks(text,jsonb)
to service_role;

comment on table public.automation_runtime_controls is
  'Database kill switch and requested execution ceiling. Environment dry-run remains authoritative.';
comment on table public.pilot_release_plans is
  'Human-owned pilot plan. Approval records intent only and never activates n8n or changes environment variables.';

commit;
