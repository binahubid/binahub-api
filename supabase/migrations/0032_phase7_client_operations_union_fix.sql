-- Phase 7: repair client-operations candidate typing discovered during integrated UAT.
-- PostgreSQL resolves a chain of untyped NULL values in UNION ALL as text. Explicit
-- UUID casts keep the candidate query compatible when a later branch supplies an ID.

begin;

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
    account.id, null::uuid, null::uuid, null::uuid,
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
    account.id, null::uuid, null::uuid, null::uuid,
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
    account.id, null::uuid, null::uuid, null::uuid,
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
    project.client_account_id, project.id, null::uuid, null::uuid,
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
    project.client_account_id, project.id, milestone.id, null::uuid,
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
    opportunity.client_account_id, opportunity.source_project_id, null::uuid, opportunity.id,
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

comment on function public.sync_client_operations_tasks(text,boolean,date) is
  'Builds the governed client-operations queue; Phase 7 explicitly types nullable UUID columns for UNION safety.';

commit;
