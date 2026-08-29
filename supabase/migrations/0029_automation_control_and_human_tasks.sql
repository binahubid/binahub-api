-- Phase 4: automation control, human task queue, SLA visibility, and run audit.
-- Automation remains safe-by-default: the scheduler can inspect candidates in dry-run
-- and only creates operational tasks when explicitly enabled by the API environment.

begin;

create table if not exists public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  task_key text not null unique,
  task_type text not null,
  title text not null,
  description text,
  priority text not null default 'medium',
  status text not null default 'open',
  assigned_to text,
  due_at timestamptz,
  sla_policy_key text,
  escalation_level integer not null default 0,
  escalated_at timestamptz,
  lead_id uuid references public.leads(id) on delete set null,
  client_account_id uuid references public.client_accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  milestone_id uuid references public.project_milestones(id) on delete cascade,
  retention_opportunity_id uuid references public.retention_opportunities(id) on delete cascade,
  source_event_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  resolution_note text,
  completed_at timestamptz,
  completed_by text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_tasks_type_valid check (
    task_type in (
      'client_review', 'renewal_review', 'account_risk', 'delivery_risk',
      'milestone_overdue', 'retention_action', 'proposal_review', 'system_alert'
    )
  ),
  constraint operational_tasks_priority_valid check (priority in ('low', 'medium', 'high', 'critical')),
  constraint operational_tasks_status_valid check (status in ('open', 'in_progress', 'waiting', 'completed', 'cancelled')),
  constraint operational_tasks_escalation_valid check (escalation_level between 0 and 3),
  constraint operational_tasks_completion_valid check (
    (status not in ('completed', 'cancelled'))
    or (
      completed_at is not null
      and completed_by is not null
      and resolution_note is not null
      and length(btrim(resolution_note)) >= 5
    )
  )
);

create index if not exists operational_tasks_queue_idx
  on public.operational_tasks (status, priority, due_at nulls last, created_at);
create index if not exists operational_tasks_assignee_idx
  on public.operational_tasks (assigned_to, status, due_at nulls last);
create index if not exists operational_tasks_client_idx
  on public.operational_tasks (client_account_id, status, created_at desc);

create table if not exists public.operational_task_events (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operational_tasks(id) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists operational_task_events_task_idx
  on public.operational_task_events (task_id, created_at desc);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_key text not null,
  idempotency_key text not null,
  trigger_source text not null default 'n8n',
  dry_run boolean not null default true,
  status text not null default 'running',
  reference_date date,
  candidate_count integer not null default 0,
  processed_count integer not null default 0,
  failure_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint automation_runs_identity_unique unique (workflow_key, idempotency_key),
  constraint automation_runs_status_valid check (status in ('running', 'succeeded', 'partial', 'failed', 'deferred')),
  constraint automation_runs_counts_valid check (candidate_count >= 0 and processed_count >= 0 and failure_count >= 0)
);

create index if not exists automation_runs_workflow_idx
  on public.automation_runs (workflow_key, started_at desc);
create index if not exists automation_runs_status_idx
  on public.automation_runs (status, started_at desc);

drop trigger if exists operational_tasks_set_updated_at on public.operational_tasks;
create trigger operational_tasks_set_updated_at
before update on public.operational_tasks
for each row execute function public.set_updated_at();

alter table public.operational_tasks enable row level security;
alter table public.operational_task_events enable row level security;
alter table public.automation_runs enable row level security;

revoke all on table
  public.operational_tasks,
  public.operational_task_events,
  public.automation_runs
from public, anon, authenticated;

grant select, insert, update on table public.operational_tasks to service_role;
grant select, insert on table public.operational_task_events to service_role;
grant select, insert, update on table public.automation_runs to service_role;

create or replace function public.sync_client_operations_tasks(
  p_actor text,
  p_dry_run boolean default true,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  candidate_payload jsonb := '[]'::jsonb;
  candidate_total integer := 0;
  created_total integer := 0;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then
    raise exception 'AUTOMATION_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_reference_date is null then
    raise exception 'REFERENCE_DATE_REQUIRED' using errcode = '22023';
  end if;

  create temporary table if not exists phase4_candidates (
    task_key text,
    task_type text,
    title text,
    description text,
    priority text,
    assigned_to text,
    due_at timestamptz,
    sla_policy_key text,
    client_account_id uuid,
    project_id uuid,
    milestone_id uuid,
    retention_opportunity_id uuid,
    source_event_at timestamptz,
    metadata jsonb
  ) on commit drop;
  truncate table pg_temp.phase4_candidates;

  insert into pg_temp.phase4_candidates
  select
    'client-review:' || account.id || ':' || account.next_review_at,
    'client_review',
    'Review client account jatuh tempo',
    'Tinjau kesehatan account, stakeholder, delivery, dan next action.',
    case when account.health_status in ('at_risk', 'critical') then 'high' else 'medium' end,
    account.commercial_owner,
    account.next_review_at::timestamptz + interval '9 hours',
    'client_review_due',
    account.id, null, null, null,
    account.next_review_at::timestamptz,
    jsonb_build_object('healthStatus', account.health_status, 'reviewDate', account.next_review_at)
  from public.client_accounts account
  where account.status not in ('inactive', 'churned')
    and account.next_review_at is not null
    and account.next_review_at <= p_reference_date

  union all

  select
    'renewal-review:' || account.id || ':' || account.renewal_date || ':' ||
      case
        when account.renewal_date - p_reference_date <= 30 then '30'
        when account.renewal_date - p_reference_date <= 60 then '60'
        else '90'
      end,
    'renewal_review',
    'Persiapan renewal client',
    'Review renewal, kebutuhan baru, dan keputusan human gate sebelum menghubungi client.',
    case when account.renewal_date <= p_reference_date then 'critical'
         when account.renewal_date - p_reference_date <= 30 then 'high'
         else 'medium' end,
    account.commercial_owner,
    greatest(account.renewal_date - 7, p_reference_date)::timestamptz + interval '9 hours',
    'renewal_90_60_30',
    account.id, null, null, null,
    account.renewal_date::timestamptz,
    jsonb_build_object(
      'renewalDate', account.renewal_date,
      'daysRemaining', account.renewal_date - p_reference_date,
      'reminderBucket', case
        when account.renewal_date - p_reference_date <= 30 then 30
        when account.renewal_date - p_reference_date <= 60 then 60
        else 90 end
    )
  from public.client_accounts account
  where account.status not in ('inactive', 'churned')
    and account.renewal_date is not null
    and account.renewal_date <= p_reference_date + 90

  union all

  select
    'account-risk:' || account.id || ':' || account.updated_at::date,
    'account_risk',
    'Account memerlukan intervensi manusia',
    'Account berstatus risiko dan harus memiliki owner serta rencana tindak lanjut.',
    case when account.health_status = 'critical' then 'critical' else 'high' end,
    coalesce(account.commercial_owner, account.delivery_owner),
    p_reference_date::timestamptz + interval '9 hours',
    'account_risk_response',
    account.id, null, null, null,
    account.updated_at,
    jsonb_build_object('healthStatus', account.health_status, 'healthScore', account.health_score)
  from public.client_accounts account
  where account.status not in ('inactive', 'churned')
    and account.health_status in ('at_risk', 'critical')

  union all

  select
    'delivery-risk:' || project.id || ':' || project.updated_at::date,
    'delivery_risk',
    'Delivery project berisiko',
    coalesce(project.risk_summary, 'Project memerlukan review risiko dan keputusan owner.'),
    case when project.risk_level = 'critical' then 'critical' else 'high' end,
    project.delivery_owner,
    p_reference_date::timestamptz + interval '9 hours',
    'delivery_risk_response',
    project.client_account_id, project.id, null, null,
    project.updated_at,
    jsonb_build_object('deliveryStage', project.delivery_stage, 'riskLevel', project.risk_level)
  from public.projects project
  where project.client_account_id is not null
    and project.delivery_stage not in ('completed', 'cancelled')
    and (project.delivery_stage = 'at_risk' or project.risk_level in ('high', 'critical'))

  union all

  select
    'milestone-overdue:' || milestone.id || ':' || milestone.due_date,
    'milestone_overdue',
    'Milestone delivery melewati tenggat',
    milestone.title,
    case when milestone.status = 'blocked' then 'critical' else 'high' end,
    milestone.owner,
    milestone.due_date::timestamptz + interval '9 hours',
    'milestone_overdue',
    project.client_account_id, project.id, milestone.id, null,
    milestone.due_date::timestamptz,
    jsonb_build_object('milestoneStatus', milestone.status, 'progress', milestone.progress, 'blockerReason', milestone.blocker_reason)
  from public.project_milestones milestone
  join public.projects project on project.id = milestone.project_id
  where project.client_account_id is not null
    and milestone.due_date is not null
    and milestone.due_date < p_reference_date
    and milestone.status not in ('completed', 'cancelled')

  union all

  select
    'retention-action:' || opportunity.id || ':' || opportunity.next_action_due_at::date,
    'retention_action',
    'Next action retention jatuh tempo',
    coalesce(opportunity.next_action, 'Review retention opportunity.'),
    case when opportunity.next_action_due_at::date < p_reference_date then 'high' else 'medium' end,
    opportunity.owner,
    opportunity.next_action_due_at,
    'retention_next_action',
    opportunity.client_account_id, opportunity.source_project_id, null, opportunity.id,
    opportunity.next_action_due_at,
    jsonb_build_object('opportunityType', opportunity.opportunity_type, 'status', opportunity.status)
  from public.retention_opportunities opportunity
  where opportunity.status not in ('won', 'lost')
    and opportunity.next_action_due_at is not null
    and opportunity.next_action_due_at::date <= p_reference_date;

  select count(*) into candidate_total from pg_temp.phase4_candidates;

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskKey', task_key,
    'taskType', task_type,
    'title', title,
    'priority', priority,
    'assignedTo', assigned_to,
    'dueAt', due_at,
    'clientAccountId', client_account_id,
    'projectId', project_id,
    'milestoneId', milestone_id,
    'retentionOpportunityId', retention_opportunity_id,
    'metadata', metadata
  ) order by due_at nulls last, priority desc), '[]'::jsonb)
  into candidate_payload
  from pg_temp.phase4_candidates;

  if not coalesce(p_dry_run, true) then
    with inserted as (
      insert into public.operational_tasks (
        task_key, task_type, title, description, priority, status, assigned_to,
        due_at, sla_policy_key, client_account_id, project_id, milestone_id,
        retention_opportunity_id, source_event_at, metadata, created_by, updated_by
      )
      select
        task_key, task_type, title, description, priority, 'open', nullif(lower(btrim(assigned_to)), ''),
        due_at, sla_policy_key, client_account_id, project_id, milestone_id,
        retention_opportunity_id, source_event_at, metadata, btrim(p_actor), btrim(p_actor)
      from pg_temp.phase4_candidates
      on conflict (task_key) do nothing
      returning id, created_by
    )
    insert into public.operational_task_events (task_id, event_type, actor, after_snapshot, note)
    select id, 'created_by_automation', created_by, jsonb_build_object('status', 'open'), 'Tugas dibuat oleh scheduler Fase 4.'
    from inserted;

    get diagnostics created_total = row_count;
  end if;

  return jsonb_build_object(
    'success', true,
    'dryRun', coalesce(p_dry_run, true),
    'referenceDate', p_reference_date,
    'candidateCount', candidate_total,
    'createdCount', created_total,
    'candidates', candidate_payload
  );
end;
$$;

revoke all on function public.sync_client_operations_tasks(text,boolean,date) from public, anon, authenticated;
grant execute on function public.sync_client_operations_tasks(text,boolean,date) to service_role;

create or replace function public.update_operational_task(
  p_task_id uuid,
  p_actor text,
  p_status text,
  p_priority text,
  p_assigned_to text,
  p_due_at timestamptz,
  p_resolution_note text
)
returns public.operational_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.operational_tasks%rowtype;
  saved_record public.operational_tasks%rowtype;
  next_escalation integer;
begin
  if p_status not in ('open', 'in_progress', 'waiting', 'completed', 'cancelled') then
    raise exception 'INVALID_OPERATIONAL_TASK_STATUS' using errcode = '22023';
  end if;
  if p_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'INVALID_OPERATIONAL_TASK_PRIORITY' using errcode = '22023';
  end if;
  if p_status in ('in_progress', 'waiting') and (p_assigned_to is null or length(btrim(p_assigned_to)) < 3) then
    raise exception 'OPERATIONAL_TASK_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_status in ('completed', 'cancelled') and (p_resolution_note is null or length(btrim(p_resolution_note)) < 5) then
    raise exception 'OPERATIONAL_TASK_RESOLUTION_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record
  from public.operational_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception 'OPERATIONAL_TASK_NOT_FOUND' using errcode = 'P0002';
  end if;

  next_escalation := case
    when p_priority = 'critical' and before_record.priority <> 'critical' then least(before_record.escalation_level + 1, 3)
    else before_record.escalation_level
  end;

  update public.operational_tasks
  set status = p_status,
      priority = p_priority,
      assigned_to = nullif(lower(btrim(p_assigned_to)), ''),
      due_at = p_due_at,
      resolution_note = case when p_status in ('completed', 'cancelled') then btrim(p_resolution_note) else null end,
      completed_at = case when p_status in ('completed', 'cancelled') then now() else null end,
      completed_by = case when p_status in ('completed', 'cancelled') then btrim(p_actor) else null end,
      escalation_level = next_escalation,
      escalated_at = case when next_escalation > before_record.escalation_level then now() else escalated_at end,
      updated_by = btrim(p_actor)
  where id = p_task_id
  returning * into saved_record;

  insert into public.operational_task_events (
    task_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved_record.id,
    case when saved_record.status in ('completed', 'cancelled') then 'resolved' else 'updated' end,
    btrim(p_actor),
    jsonb_build_object('status', before_record.status, 'priority', before_record.priority, 'assignedTo', before_record.assigned_to, 'dueAt', before_record.due_at),
    jsonb_build_object('status', saved_record.status, 'priority', saved_record.priority, 'assignedTo', saved_record.assigned_to, 'dueAt', saved_record.due_at),
    nullif(btrim(p_resolution_note), '')
  );

  return saved_record;
end;
$$;

revoke all on function public.update_operational_task(uuid,text,text,text,text,timestamptz,text)
  from public, anon, authenticated;
grant execute on function public.update_operational_task(uuid,text,text,text,text,timestamptz,text)
  to service_role;

comment on table public.operational_tasks is
  'Human-owned operational queue generated by deterministic business signals; AI and schedulers cannot complete these tasks.';
comment on table public.automation_runs is
  'Idempotent execution audit for n8n and API automation workflows.';

commit;
