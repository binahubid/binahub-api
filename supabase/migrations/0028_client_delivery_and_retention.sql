-- Phase 3 client lifecycle: atomic won-to-client handoff, delivery governance,
-- account health, and human-gated retention opportunities.

begin;

alter table public.organizations
  add column if not exists location text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  source_lead_id uuid references public.leads(id) on delete set null,
  commercial_owner text not null,
  delivery_owner text not null,
  status text not null default 'onboarding',
  health_score numeric(5,2),
  health_status text not null default 'unknown',
  next_review_at date,
  renewal_date date,
  retain_status text not null default 'monitoring',
  churn_reason text,
  notes text,
  client_since timestamptz not null default now(),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_accounts_organization_unique unique (organization_id),
  constraint client_accounts_source_lead_unique unique (source_lead_id),
  constraint client_accounts_status_valid
    check (status in ('onboarding', 'active', 'at_risk', 'inactive', 'churned')),
  constraint client_accounts_health_score_valid
    check (health_score is null or (health_score >= 0 and health_score <= 100)),
  constraint client_accounts_health_status_valid
    check (health_status in ('unknown', 'healthy', 'watch', 'at_risk', 'critical')),
  constraint client_accounts_retain_status_valid
    check (retain_status in ('monitoring', 'opportunity', 'renewal_due', 'expanded', 'churned')),
  constraint client_accounts_owners_valid check (
    length(btrim(commercial_owner)) between 3 and 320
    and length(btrim(delivery_owner)) between 3 and 320
  ),
  constraint client_accounts_churn_reason_valid check (
    status <> 'churned' or (churn_reason is not null and length(btrim(churn_reason)) >= 5)
  )
);

create index if not exists client_accounts_status_review_idx
  on public.client_accounts (status, next_review_at, updated_at desc);
create index if not exists client_accounts_delivery_owner_idx
  on public.client_accounts (delivery_owner, status, updated_at desc);

create table if not exists public.client_stakeholders (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  source_lead_id uuid references public.leads(id) on delete set null,
  name text not null,
  email text,
  email_normalized text generated always as (lower(btrim(email))) stored,
  phone text,
  role_title text,
  department text,
  relationship_role text not null default 'pic',
  is_primary boolean not null default false,
  active boolean not null default true,
  last_verified_at timestamptz,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_stakeholders_name_valid check (length(btrim(name)) between 2 and 200),
  constraint client_stakeholders_email_valid check (
    email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  constraint client_stakeholders_relationship_role_valid check (
    relationship_role in ('sponsor', 'decision_maker', 'champion', 'pic', 'buyer', 'user', 'blocker', 'other')
  ),
  constraint client_stakeholders_account_email_unique unique (client_account_id, email_normalized)
);

create unique index if not exists client_stakeholders_one_primary_idx
  on public.client_stakeholders (client_account_id)
  where is_primary and active;
create index if not exists client_stakeholders_account_active_idx
  on public.client_stakeholders (client_account_id, active, updated_at desc);

alter table public.projects
  add column if not exists client_account_id uuid references public.client_accounts(id) on delete set null,
  add column if not exists source_lead_id uuid references public.leads(id) on delete set null,
  add column if not exists engagement_id uuid references public.engagements(id) on delete set null,
  add column if not exists delivery_stage text,
  add column if not exists delivery_owner text,
  add column if not exists kickoff_at date,
  add column if not exists delivery_goal text,
  add column if not exists success_metrics jsonb not null default '[]'::jsonb,
  add column if not exists risk_level text not null default 'low',
  add column if not exists risk_summary text,
  add column if not exists initial_handoff boolean not null default false,
  add column if not exists handoff_approved_by text,
  add column if not exists handoff_approved_at timestamptz,
  add column if not exists created_by text,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.projects
  drop constraint if exists projects_delivery_stage_valid;
alter table public.projects
  add constraint projects_delivery_stage_valid check (
    delivery_stage is null
    or delivery_stage in ('handoff', 'kickoff', 'planning', 'in_progress', 'at_risk', 'on_hold', 'completed', 'cancelled')
  ) not valid;

alter table public.projects
  drop constraint if exists projects_risk_level_valid;
alter table public.projects
  add constraint projects_risk_level_valid
  check (risk_level in ('low', 'medium', 'high', 'critical')) not valid;

create unique index if not exists projects_initial_handoff_source_lead_idx
  on public.projects (source_lead_id)
  where initial_handoff and source_lead_id is not null;
create index if not exists projects_client_delivery_idx
  on public.projects (client_account_id, delivery_stage, updated_at desc)
  where client_account_id is not null;

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  owner text not null,
  due_date date,
  status text not null default 'planned',
  progress integer not null default 0,
  weight numeric(5,2) not null default 0,
  blocker_reason text,
  completed_at timestamptz,
  completed_by text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_milestones_title_valid check (length(btrim(title)) between 2 and 300),
  constraint project_milestones_owner_valid check (length(btrim(owner)) between 3 and 320),
  constraint project_milestones_status_valid
    check (status in ('planned', 'in_progress', 'blocked', 'completed', 'cancelled')),
  constraint project_milestones_progress_valid check (progress between 0 and 100),
  constraint project_milestones_weight_valid check (weight between 0 and 100),
  constraint project_milestones_blocker_valid check (
    status <> 'blocked' or (blocker_reason is not null and length(btrim(blocker_reason)) >= 5)
  )
);

create index if not exists project_milestones_project_due_idx
  on public.project_milestones (project_id, status, due_date, updated_at desc);

create table if not exists public.account_health_reviews (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  review_date date not null default current_date,
  delivery_score integer not null,
  engagement_score integer not null,
  sentiment_score integer not null,
  commercial_score integer not null,
  overall_score numeric(5,2) not null,
  risk_level text not null,
  risk_reasons text[] not null default '{}',
  notes text,
  next_action text,
  next_action_due_at date,
  reviewed_by text not null,
  created_at timestamptz not null default now(),
  constraint account_health_reviews_scores_valid check (
    delivery_score between 1 and 5
    and engagement_score between 1 and 5
    and sentiment_score between 1 and 5
    and commercial_score between 1 and 5
    and overall_score between 0 and 100
  ),
  constraint account_health_reviews_risk_level_valid
    check (risk_level in ('healthy', 'watch', 'at_risk', 'critical')),
  constraint account_health_reviews_action_valid check (
    risk_level not in ('at_risk', 'critical')
    or (
      next_action is not null and length(btrim(next_action)) >= 3
      and next_action_due_at is not null
    )
  )
);

create index if not exists account_health_reviews_account_date_idx
  on public.account_health_reviews (client_account_id, review_date desc, created_at desc);

create table if not exists public.retention_opportunities (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  source_project_id uuid references public.projects(id) on delete set null,
  opportunity_type text not null,
  status text not null default 'identified',
  owner text not null,
  module_request_data jsonb not null default '{}'::jsonb,
  estimated_value numeric(14,2),
  expected_close_date date,
  next_action text,
  next_action_due_at timestamptz,
  lost_reason text,
  human_gate_status text not null default 'pending',
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint retention_opportunities_type_valid
    check (opportunity_type in ('renewal', 'upsell', 'cross_sell', 'repeat', 'referral')),
  constraint retention_opportunities_status_valid
    check (status in ('identified', 'qualified', 'proposal', 'won', 'lost', 'on_hold')),
  constraint retention_opportunities_value_valid
    check (estimated_value is null or estimated_value >= 0),
  constraint retention_opportunities_gate_valid
    check (human_gate_status in ('pending', 'approved', 'rejected')),
  constraint retention_opportunities_lost_reason_valid check (
    status <> 'lost' or (lost_reason is not null and length(btrim(lost_reason)) >= 5)
  ),
  constraint retention_opportunities_approval_complete check (
    status not in ('proposal', 'won')
    or (
      human_gate_status = 'approved'
      and approved_by is not null
      and approved_at is not null
      and approval_note is not null
      and length(btrim(approval_note)) >= 5
    )
  )
);

create index if not exists retention_opportunities_account_status_idx
  on public.retention_opportunities (client_account_id, status, next_action_due_at, updated_at desc);

create table if not exists public.client_activities (
  id uuid primary key default gen_random_uuid(),
  client_account_id uuid not null references public.client_accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  milestone_id uuid references public.project_milestones(id) on delete set null,
  retention_opportunity_id uuid references public.retention_opportunities(id) on delete set null,
  event_type text not null,
  actor text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint client_activities_event_type_valid check (event_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint client_activities_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists client_activities_account_created_idx
  on public.client_activities (client_account_id, created_at desc);
create index if not exists client_activities_project_created_idx
  on public.client_activities (project_id, created_at desc)
  where project_id is not null;

drop trigger if exists client_accounts_set_updated_at on public.client_accounts;
create trigger client_accounts_set_updated_at
before update on public.client_accounts
for each row execute function public.set_transformation_updated_at();

drop trigger if exists client_stakeholders_set_updated_at on public.client_stakeholders;
create trigger client_stakeholders_set_updated_at
before update on public.client_stakeholders
for each row execute function public.set_transformation_updated_at();

drop trigger if exists projects_phase3_set_updated_at on public.projects;
create trigger projects_phase3_set_updated_at
before update on public.projects
for each row execute function public.set_transformation_updated_at();

drop trigger if exists project_milestones_set_updated_at on public.project_milestones;
create trigger project_milestones_set_updated_at
before update on public.project_milestones
for each row execute function public.set_transformation_updated_at();

drop trigger if exists retention_opportunities_set_updated_at on public.retention_opportunities;
create trigger retention_opportunities_set_updated_at
before update on public.retention_opportunities
for each row execute function public.set_transformation_updated_at();

alter table public.client_accounts enable row level security;
alter table public.client_stakeholders enable row level security;
alter table public.project_milestones enable row level security;
alter table public.account_health_reviews enable row level security;
alter table public.retention_opportunities enable row level security;
alter table public.client_activities enable row level security;

revoke all on table
  public.client_accounts,
  public.client_stakeholders,
  public.project_milestones,
  public.account_health_reviews,
  public.retention_opportunities,
  public.client_activities
from anon, authenticated;

grant select, insert, update on table
  public.client_accounts,
  public.client_stakeholders,
  public.project_milestones,
  public.retention_opportunities
to service_role;
grant select, insert on table public.account_health_reviews, public.client_activities to service_role;

create or replace function public.convert_won_lead_to_client(
  p_lead_id uuid,
  p_actor text,
  p_commercial_owner text,
  p_delivery_owner text,
  p_project_title text,
  p_kickoff_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_lead public.leads%rowtype;
  organization_record public.organizations%rowtype;
  account_record public.client_accounts%rowtype;
  stakeholder_record public.client_stakeholders%rowtype;
  project_record public.projects%rowtype;
  organization_name text;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then
    raise exception 'ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_commercial_owner is null or length(btrim(p_commercial_owner)) < 3 then
    raise exception 'COMMERCIAL_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_delivery_owner is null or length(btrim(p_delivery_owner)) < 3 then
    raise exception 'DELIVERY_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_project_title is null or length(btrim(p_project_title)) < 3 then
    raise exception 'PROJECT_TITLE_REQUIRED' using errcode = '22023';
  end if;

  select * into source_lead
  from public.leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if source_lead.opportunity_stage <> 'won' then
    raise exception 'LEAD_NOT_WON' using errcode = '22023';
  end if;
  if source_lead.company is null or length(btrim(source_lead.company)) < 2 then
    raise exception 'COMPANY_REQUIRED' using errcode = '22023';
  end if;

  organization_name := btrim(source_lead.company);
  perform pg_advisory_xact_lock(hashtextextended(lower(organization_name), 0));

  select * into organization_record
  from public.organizations
  where lower(btrim(name)) = lower(organization_name)
  order by created_at
  limit 1
  for update;

  if organization_record.id is null then
    insert into public.organizations (name, industry, size, location)
    values (
      organization_name,
      nullif(btrim(source_lead.industry), ''),
      nullif(btrim(source_lead.qualification_profile->>'employeeRange'), ''),
      nullif(btrim(source_lead.location), '')
    )
    returning * into organization_record;
  else
    update public.organizations
    set industry = coalesce(industry, nullif(btrim(source_lead.industry), '')),
        size = coalesce(size, nullif(btrim(source_lead.qualification_profile->>'employeeRange'), '')),
        location = coalesce(location, nullif(btrim(source_lead.location), '')),
        updated_at = now()
    where id = organization_record.id
    returning * into organization_record;
  end if;

  select * into account_record
  from public.client_accounts
  where organization_id = organization_record.id
  for update;

  if account_record.id is null then
    insert into public.client_accounts (
      organization_id, source_lead_id, commercial_owner, delivery_owner,
      status, created_by, updated_by
    ) values (
      organization_record.id, source_lead.id, btrim(p_commercial_owner), btrim(p_delivery_owner),
      'onboarding', btrim(p_actor), btrim(p_actor)
    )
    returning * into account_record;
  else
    update public.client_accounts
    set source_lead_id = coalesce(source_lead_id, source_lead.id),
        commercial_owner = btrim(p_commercial_owner),
        delivery_owner = btrim(p_delivery_owner),
        status = case when status in ('inactive', 'churned') then 'onboarding' else status end,
        churn_reason = null,
        updated_by = btrim(p_actor)
    where id = account_record.id
    returning * into account_record;
  end if;

  if source_lead.email is not null and btrim(source_lead.email) <> '' then
    update public.client_stakeholders
    set is_primary = false
    where client_account_id = account_record.id and is_primary;

    insert into public.client_stakeholders (
      client_account_id, source_lead_id, name, email, phone, role_title,
      relationship_role, is_primary, active, last_verified_at, created_by
    ) values (
      account_record.id, source_lead.id, coalesce(nullif(btrim(source_lead.name), ''), 'Primary Contact'),
      lower(btrim(source_lead.email)), nullif(btrim(source_lead.phone), ''),
      nullif(btrim(source_lead.qualification_profile->>'role'), ''),
      'pic', true, true, now(), btrim(p_actor)
    )
    on conflict (client_account_id, email_normalized) do update
    set name = excluded.name,
        phone = coalesce(excluded.phone, public.client_stakeholders.phone),
        role_title = coalesce(excluded.role_title, public.client_stakeholders.role_title),
        source_lead_id = excluded.source_lead_id,
        is_primary = true,
        active = true,
        last_verified_at = now()
    returning * into stakeholder_record;
  end if;

  select * into project_record
  from public.projects
  where source_lead_id = source_lead.id and initial_handoff
  limit 1
  for update;

  if project_record.id is null then
    insert into public.projects (
      client_name, contact_name, contact_email, program_name, project_type,
      status, client_account_id, source_lead_id, delivery_stage, delivery_owner,
      kickoff_at, risk_level, initial_handoff, handoff_approved_by,
      handoff_approved_at, created_by, source_type, source_id, automation_mode
    ) values (
      organization_record.name, source_lead.name, source_lead.email, btrim(p_project_title),
      'Project Delivery', 'Draft', account_record.id, source_lead.id, 'handoff',
      btrim(p_delivery_owner), p_kickoff_date, 'low', true, btrim(p_actor), now(),
      btrim(p_actor), 'won_lead', source_lead.id::text, 'approval_required'
    )
    returning * into project_record;
  else
    update public.projects
    set client_account_id = account_record.id,
        delivery_owner = btrim(p_delivery_owner),
        kickoff_at = coalesce(p_kickoff_date, kickoff_at),
        handoff_approved_by = btrim(p_actor),
        handoff_approved_at = coalesce(handoff_approved_at, now())
    where id = project_record.id
    returning * into project_record;
  end if;

  update public.leads
  set lifecycle_stage = 'client',
      outreach_paused = true,
      outreach_pause_reason = 'converted_to_client',
      outreach_paused_at = coalesce(outreach_paused_at, now()),
      outreach_paused_by = btrim(p_actor),
      last_meaningful_activity_at = now(),
      pipeline_updated_at = now()
  where id = source_lead.id;

  insert into public.client_activities (
    client_account_id, project_id, event_type, actor, note, metadata
  ) values (
    account_record.id, project_record.id, 'client_handoff_created', btrim(p_actor),
    'Won opportunity dikonversi menjadi client dan delivery handoff.',
    jsonb_build_object('leadId', source_lead.id, 'organizationId', organization_record.id)
  );

  insert into public.opportunity_activities (
    lead_id, event_type, from_stage, to_stage, actor, note, metadata
  ) values (
    source_lead.id, 'client_handoff_created', 'won', 'won', btrim(p_actor),
    'Client account dan initial delivery project dibuat.',
    jsonb_build_object('clientAccountId', account_record.id, 'projectId', project_record.id)
  );

  return jsonb_build_object(
    'organization', to_jsonb(organization_record),
    'account', to_jsonb(account_record),
    'stakeholder', case when stakeholder_record.id is null then null else to_jsonb(stakeholder_record) end,
    'project', to_jsonb(project_record)
  );
end;
$$;

revoke all on function public.convert_won_lead_to_client(uuid,text,text,text,text,date)
  from public, anon, authenticated;
grant execute on function public.convert_won_lead_to_client(uuid,text,text,text,text,date)
  to service_role;

create or replace function public.update_client_account(
  p_client_account_id uuid,
  p_actor text,
  p_status text,
  p_commercial_owner text,
  p_delivery_owner text,
  p_next_review_at date,
  p_renewal_date date,
  p_retain_status text,
  p_notes text,
  p_change_reason text
)
returns public.client_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.client_accounts%rowtype;
  saved_record public.client_accounts%rowtype;
begin
  if p_status not in ('onboarding', 'active', 'at_risk', 'inactive', 'churned') then
    raise exception 'INVALID_CLIENT_STATUS' using errcode = '22023';
  end if;
  if p_retain_status not in ('monitoring', 'opportunity', 'renewal_due', 'expanded', 'churned') then
    raise exception 'INVALID_RETAIN_STATUS' using errcode = '22023';
  end if;
  if p_status in ('at_risk', 'inactive', 'churned')
    and (p_change_reason is null or length(btrim(p_change_reason)) < 5) then
    raise exception 'CHANGE_REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_commercial_owner is null or length(btrim(p_commercial_owner)) < 3
    or p_delivery_owner is null or length(btrim(p_delivery_owner)) < 3 then
    raise exception 'ACCOUNT_OWNERS_REQUIRED' using errcode = '22023';
  end if;

  select * into before_record
  from public.client_accounts
  where id = p_client_account_id
  for update;
  if not found then
    raise exception 'CLIENT_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.client_accounts
  set status = p_status,
      commercial_owner = btrim(p_commercial_owner),
      delivery_owner = btrim(p_delivery_owner),
      next_review_at = p_next_review_at,
      renewal_date = p_renewal_date,
      retain_status = p_retain_status,
      churn_reason = case when p_status = 'churned' then btrim(p_change_reason) else null end,
      notes = nullif(btrim(p_notes), ''),
      updated_by = btrim(p_actor)
  where id = p_client_account_id
  returning * into saved_record;

  insert into public.client_activities (
    client_account_id, event_type, actor, note, metadata
  ) values (
    saved_record.id, 'client_account_updated', btrim(p_actor), nullif(btrim(p_change_reason), ''),
    jsonb_build_object(
      'before', jsonb_build_object('status', before_record.status, 'retainStatus', before_record.retain_status),
      'after', jsonb_build_object('status', saved_record.status, 'retainStatus', saved_record.retain_status)
    )
  );

  return saved_record;
end;
$$;

revoke all on function public.update_client_account(uuid,text,text,text,text,date,date,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_client_account(uuid,text,text,text,text,date,date,text,text,text)
  to service_role;

create or replace function public.save_client_stakeholder(
  p_id uuid,
  p_client_account_id uuid,
  p_actor text,
  p_name text,
  p_email text,
  p_phone text,
  p_role_title text,
  p_department text,
  p_relationship_role text,
  p_is_primary boolean,
  p_active boolean,
  p_notes text
)
returns public.client_stakeholders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_record public.client_stakeholders%rowtype;
begin
  if p_name is null or length(btrim(p_name)) < 2 then
    raise exception 'STAKEHOLDER_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_relationship_role not in ('sponsor', 'decision_maker', 'champion', 'pic', 'buyer', 'user', 'blocker', 'other') then
    raise exception 'INVALID_STAKEHOLDER_ROLE' using errcode = '22023';
  end if;
  if coalesce(p_is_primary, false) and not coalesce(p_active, true) then
    raise exception 'PRIMARY_STAKEHOLDER_MUST_BE_ACTIVE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.client_accounts where id = p_client_account_id) then
    raise exception 'CLIENT_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if coalesce(p_is_primary, false) then
    update public.client_stakeholders
    set is_primary = false
    where client_account_id = p_client_account_id
      and is_primary
      and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into public.client_stakeholders (
      client_account_id, name, email, phone, role_title, department,
      relationship_role, is_primary, active, last_verified_at, notes, created_by
    ) values (
      p_client_account_id, btrim(p_name), nullif(lower(btrim(p_email)), ''),
      nullif(btrim(p_phone), ''), nullif(btrim(p_role_title), ''), nullif(btrim(p_department), ''),
      p_relationship_role, coalesce(p_is_primary, false), coalesce(p_active, true), now(),
      nullif(btrim(p_notes), ''), btrim(p_actor)
    )
    on conflict (client_account_id, email_normalized) do update
    set name = excluded.name,
        phone = excluded.phone,
        role_title = excluded.role_title,
        department = excluded.department,
        relationship_role = excluded.relationship_role,
        is_primary = excluded.is_primary,
        active = excluded.active,
        last_verified_at = now(),
        notes = excluded.notes
    returning * into saved_record;
  else
    update public.client_stakeholders
    set name = btrim(p_name),
        email = nullif(lower(btrim(p_email)), ''),
        phone = nullif(btrim(p_phone), ''),
        role_title = nullif(btrim(p_role_title), ''),
        department = nullif(btrim(p_department), ''),
        relationship_role = p_relationship_role,
        is_primary = coalesce(p_is_primary, false),
        active = coalesce(p_active, true),
        last_verified_at = now(),
        notes = nullif(btrim(p_notes), '')
    where id = p_id and client_account_id = p_client_account_id
    returning * into saved_record;
    if not found then
      raise exception 'STAKEHOLDER_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  insert into public.client_activities (
    client_account_id, event_type, actor, note, metadata
  ) values (
    p_client_account_id, 'client_stakeholder_saved', btrim(p_actor), nullif(btrim(p_notes), ''),
    jsonb_build_object(
      'stakeholderId', saved_record.id,
      'relationshipRole', saved_record.relationship_role,
      'isPrimary', saved_record.is_primary,
      'active', saved_record.active
    )
  );

  return saved_record;
end;
$$;

revoke all on function public.save_client_stakeholder(uuid,uuid,text,text,text,text,text,text,text,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function public.save_client_stakeholder(uuid,uuid,text,text,text,text,text,text,text,boolean,boolean,text)
  to service_role;

create or replace function public.update_delivery_project(
  p_project_id uuid,
  p_actor text,
  p_delivery_stage text,
  p_delivery_owner text,
  p_start_date date,
  p_end_date date,
  p_delivery_goal text,
  p_success_metrics jsonb,
  p_risk_level text,
  p_risk_summary text,
  p_note text
)
returns public.projects
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.projects%rowtype;
  saved_record public.projects%rowtype;
begin
  if p_delivery_stage not in ('handoff', 'kickoff', 'planning', 'in_progress', 'at_risk', 'on_hold', 'completed', 'cancelled') then
    raise exception 'INVALID_DELIVERY_STAGE' using errcode = '22023';
  end if;
  if p_risk_level not in ('low', 'medium', 'high', 'critical') then
    raise exception 'INVALID_RISK_LEVEL' using errcode = '22023';
  end if;
  if p_delivery_stage not in ('completed', 'cancelled')
    and (p_delivery_owner is null or length(btrim(p_delivery_owner)) < 3) then
    raise exception 'DELIVERY_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if (p_delivery_stage = 'at_risk' or p_risk_level in ('high', 'critical'))
    and (p_risk_summary is null or length(btrim(p_risk_summary)) < 5) then
    raise exception 'RISK_SUMMARY_REQUIRED' using errcode = '22023';
  end if;
  if p_start_date is not null and p_end_date is not null and p_end_date < p_start_date then
    raise exception 'INVALID_PROJECT_DATE_RANGE' using errcode = '22023';
  end if;

  select * into before_record
  from public.projects
  where id = p_project_id and client_account_id is not null
  for update;
  if not found then
    raise exception 'DELIVERY_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.projects
  set delivery_stage = p_delivery_stage,
      delivery_owner = nullif(btrim(p_delivery_owner), ''),
      start_date = p_start_date,
      end_date = p_end_date,
      delivery_goal = nullif(btrim(p_delivery_goal), ''),
      success_metrics = coalesce(p_success_metrics, '[]'::jsonb),
      risk_level = p_risk_level,
      risk_summary = case when p_risk_level in ('low', 'medium') and p_delivery_stage <> 'at_risk'
        then nullif(btrim(p_risk_summary), '') else btrim(p_risk_summary) end,
      status = case
        when p_delivery_stage = 'completed' then 'Completed'
        when p_delivery_stage = 'cancelled' then 'Cancelled'
        when p_delivery_stage = 'on_hold' then 'Paused'
        when p_delivery_stage in ('in_progress', 'at_risk') then 'Active'
        else status
      end
  where id = p_project_id
  returning * into saved_record;

  insert into public.client_activities (
    client_account_id, project_id, event_type, actor, note, metadata
  ) values (
    saved_record.client_account_id, saved_record.id, 'delivery_project_updated', btrim(p_actor),
    nullif(btrim(p_note), ''),
    jsonb_build_object(
      'before', jsonb_build_object('stage', before_record.delivery_stage, 'riskLevel', before_record.risk_level),
      'after', jsonb_build_object('stage', saved_record.delivery_stage, 'riskLevel', saved_record.risk_level)
    )
  );

  return saved_record;
end;
$$;

revoke all on function public.update_delivery_project(uuid,text,text,text,date,date,text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_delivery_project(uuid,text,text,text,date,date,text,jsonb,text,text,text)
  to service_role;

create or replace function public.save_delivery_milestone(
  p_id uuid,
  p_project_id uuid,
  p_actor text,
  p_title text,
  p_description text,
  p_owner text,
  p_due_date date,
  p_status text,
  p_progress integer,
  p_weight numeric,
  p_blocker_reason text
)
returns public.project_milestones
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  project_record public.projects%rowtype;
  saved_record public.project_milestones%rowtype;
begin
  if p_status not in ('planned', 'in_progress', 'blocked', 'completed', 'cancelled') then
    raise exception 'INVALID_MILESTONE_STATUS' using errcode = '22023';
  end if;
  if p_title is null or length(btrim(p_title)) < 2 then
    raise exception 'MILESTONE_TITLE_REQUIRED' using errcode = '22023';
  end if;
  if p_owner is null or length(btrim(p_owner)) < 3 then
    raise exception 'MILESTONE_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_status = 'blocked' and (p_blocker_reason is null or length(btrim(p_blocker_reason)) < 5) then
    raise exception 'BLOCKER_REASON_REQUIRED' using errcode = '22023';
  end if;

  select * into project_record
  from public.projects
  where id = p_project_id and client_account_id is not null;
  if not found then
    raise exception 'DELIVERY_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_id is null then
    insert into public.project_milestones (
      project_id, title, description, owner, due_date, status, progress,
      weight, blocker_reason, completed_at, completed_by, created_by
    ) values (
      project_record.id, btrim(p_title), nullif(btrim(p_description), ''), btrim(p_owner),
      p_due_date, p_status, case when p_status = 'completed' then 100 else p_progress end,
      p_weight, case when p_status = 'blocked' then btrim(p_blocker_reason) else null end,
      case when p_status = 'completed' then now() else null end,
      case when p_status = 'completed' then btrim(p_actor) else null end,
      btrim(p_actor)
    )
    returning * into saved_record;
  else
    update public.project_milestones
    set title = btrim(p_title),
        description = nullif(btrim(p_description), ''),
        owner = btrim(p_owner),
        due_date = p_due_date,
        status = p_status,
        progress = case when p_status = 'completed' then 100 else p_progress end,
        weight = p_weight,
        blocker_reason = case when p_status = 'blocked' then btrim(p_blocker_reason) else null end,
        completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
        completed_by = case when p_status = 'completed' then coalesce(completed_by, btrim(p_actor)) else null end
    where id = p_id and project_id = project_record.id
    returning * into saved_record;
    if not found then
      raise exception 'MILESTONE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  insert into public.client_activities (
    client_account_id, project_id, milestone_id, event_type, actor, note, metadata
  ) values (
    project_record.client_account_id, project_record.id, saved_record.id, 'delivery_milestone_saved',
    btrim(p_actor), nullif(btrim(p_description), ''),
    jsonb_build_object('status', saved_record.status, 'progress', saved_record.progress, 'dueDate', saved_record.due_date)
  );

  return saved_record;
end;
$$;

revoke all on function public.save_delivery_milestone(uuid,uuid,text,text,text,text,date,text,integer,numeric,text)
  from public, anon, authenticated;
grant execute on function public.save_delivery_milestone(uuid,uuid,text,text,text,text,date,text,integer,numeric,text)
  to service_role;

create or replace function public.record_account_health_review(
  p_client_account_id uuid,
  p_project_id uuid,
  p_actor text,
  p_delivery_score integer,
  p_engagement_score integer,
  p_sentiment_score integer,
  p_commercial_score integer,
  p_risk_level text,
  p_risk_reasons text[],
  p_notes text,
  p_next_action text,
  p_next_action_due_at date
)
returns public.account_health_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  score numeric(5,2);
  saved_record public.account_health_reviews%rowtype;
begin
  if p_delivery_score not between 1 and 5
    or p_engagement_score not between 1 and 5
    or p_sentiment_score not between 1 and 5
    or p_commercial_score not between 1 and 5 then
    raise exception 'INVALID_HEALTH_SCORE' using errcode = '22023';
  end if;
  if p_risk_level not in ('healthy', 'watch', 'at_risk', 'critical') then
    raise exception 'INVALID_HEALTH_RISK_LEVEL' using errcode = '22023';
  end if;
  if p_risk_level in ('at_risk', 'critical')
    and (p_next_action is null or length(btrim(p_next_action)) < 3 or p_next_action_due_at is null) then
    raise exception 'HEALTH_NEXT_ACTION_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.client_accounts where id = p_client_account_id) then
    raise exception 'CLIENT_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects
    where id = p_project_id and client_account_id = p_client_account_id
  ) then
    raise exception 'DELIVERY_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  score := round(((p_delivery_score + p_engagement_score + p_sentiment_score + p_commercial_score)::numeric / 20) * 100, 2);

  insert into public.account_health_reviews (
    client_account_id, project_id, delivery_score, engagement_score,
    sentiment_score, commercial_score, overall_score, risk_level,
    risk_reasons, notes, next_action, next_action_due_at, reviewed_by
  ) values (
    p_client_account_id, p_project_id, p_delivery_score, p_engagement_score,
    p_sentiment_score, p_commercial_score, score, p_risk_level,
    coalesce(p_risk_reasons, '{}'), nullif(btrim(p_notes), ''),
    nullif(btrim(p_next_action), ''), p_next_action_due_at, btrim(p_actor)
  )
  returning * into saved_record;

  update public.client_accounts
  set health_score = score,
      health_status = p_risk_level,
      next_review_at = coalesce(p_next_action_due_at, next_review_at),
      updated_by = btrim(p_actor)
  where id = p_client_account_id;

  insert into public.client_activities (
    client_account_id, project_id, event_type, actor, note, metadata
  ) values (
    p_client_account_id, p_project_id, 'account_health_reviewed', btrim(p_actor),
    nullif(btrim(p_notes), ''),
    jsonb_build_object('overallScore', score, 'riskLevel', p_risk_level, 'riskReasons', coalesce(p_risk_reasons, '{}'))
  );

  return saved_record;
end;
$$;

revoke all on function public.record_account_health_review(uuid,uuid,text,integer,integer,integer,integer,text,text[],text,text,date)
  from public, anon, authenticated;
grant execute on function public.record_account_health_review(uuid,uuid,text,integer,integer,integer,integer,text,text[],text,text,date)
  to service_role;

create or replace function public.save_retention_opportunity(
  p_id uuid,
  p_client_account_id uuid,
  p_source_project_id uuid,
  p_actor text,
  p_opportunity_type text,
  p_status text,
  p_owner text,
  p_module_request_data jsonb,
  p_estimated_value numeric,
  p_expected_close_date date,
  p_next_action text,
  p_next_action_due_at timestamptz,
  p_lost_reason text,
  p_human_approved boolean,
  p_approval_note text
)
returns public.retention_opportunities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_record public.retention_opportunities%rowtype;
  gate_status text;
begin
  if p_opportunity_type not in ('renewal', 'upsell', 'cross_sell', 'repeat', 'referral') then
    raise exception 'INVALID_RETENTION_TYPE' using errcode = '22023';
  end if;
  if p_status not in ('identified', 'qualified', 'proposal', 'won', 'lost', 'on_hold') then
    raise exception 'INVALID_RETENTION_STATUS' using errcode = '22023';
  end if;
  if p_owner is null or length(btrim(p_owner)) < 3 then
    raise exception 'RETENTION_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_status in ('qualified', 'proposal')
    and (p_next_action is null or length(btrim(p_next_action)) < 3 or p_next_action_due_at is null) then
    raise exception 'RETENTION_NEXT_ACTION_REQUIRED' using errcode = '22023';
  end if;
  if p_status = 'lost' and (p_lost_reason is null or length(btrim(p_lost_reason)) < 5) then
    raise exception 'RETENTION_LOST_REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_status in ('proposal', 'won')
    and (not coalesce(p_human_approved, false) or p_approval_note is null or length(btrim(p_approval_note)) < 5) then
    raise exception 'RETENTION_HUMAN_APPROVAL_REQUIRED' using errcode = '22023';
  end if;
  if not exists (select 1 from public.client_accounts where id = p_client_account_id) then
    raise exception 'CLIENT_ACCOUNT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_source_project_id is not null and not exists (
    select 1 from public.projects
    where id = p_source_project_id and client_account_id = p_client_account_id
  ) then
    raise exception 'DELIVERY_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  gate_status := case when coalesce(p_human_approved, false) then 'approved' else 'pending' end;

  if p_id is null then
    insert into public.retention_opportunities (
      client_account_id, source_project_id, opportunity_type, status, owner,
      module_request_data, estimated_value, expected_close_date, next_action,
      next_action_due_at, lost_reason, human_gate_status, approved_by,
      approved_at, approval_note, created_by
    ) values (
      p_client_account_id, p_source_project_id, p_opportunity_type, p_status, btrim(p_owner),
      coalesce(p_module_request_data, '{}'::jsonb), p_estimated_value, p_expected_close_date,
      nullif(btrim(p_next_action), ''), p_next_action_due_at,
      case when p_status = 'lost' then btrim(p_lost_reason) else null end,
      gate_status, case when gate_status = 'approved' then btrim(p_actor) else null end,
      case when gate_status = 'approved' then now() else null end,
      case when gate_status = 'approved' then btrim(p_approval_note) else null end,
      btrim(p_actor)
    )
    returning * into saved_record;
  else
    update public.retention_opportunities
    set source_project_id = p_source_project_id,
        opportunity_type = p_opportunity_type,
        status = p_status,
        owner = btrim(p_owner),
        module_request_data = coalesce(p_module_request_data, '{}'::jsonb),
        estimated_value = p_estimated_value,
        expected_close_date = p_expected_close_date,
        next_action = nullif(btrim(p_next_action), ''),
        next_action_due_at = p_next_action_due_at,
        lost_reason = case when p_status = 'lost' then btrim(p_lost_reason) else null end,
        human_gate_status = gate_status,
        approved_by = case when gate_status = 'approved' then btrim(p_actor) else null end,
        approved_at = case when gate_status = 'approved' then coalesce(approved_at, now()) else null end,
        approval_note = case when gate_status = 'approved' then btrim(p_approval_note) else null end
    where id = p_id and client_account_id = p_client_account_id
    returning * into saved_record;
    if not found then
      raise exception 'RETENTION_OPPORTUNITY_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  update public.client_accounts
  set retain_status = case
        when p_status = 'won' then 'expanded'
        when p_opportunity_type = 'renewal' and p_status not in ('won', 'lost') then 'renewal_due'
        when p_status not in ('lost', 'on_hold') then 'opportunity'
        else retain_status
      end,
      updated_by = btrim(p_actor)
  where id = p_client_account_id;

  insert into public.client_activities (
    client_account_id, project_id, retention_opportunity_id, event_type, actor, note, metadata
  ) values (
    p_client_account_id, p_source_project_id, saved_record.id, 'retention_opportunity_saved',
    btrim(p_actor), nullif(btrim(p_approval_note), ''),
    jsonb_build_object('type', p_opportunity_type, 'status', p_status, 'humanGateStatus', gate_status)
  );

  return saved_record;
end;
$$;

revoke all on function public.save_retention_opportunity(uuid,uuid,uuid,text,text,text,text,jsonb,numeric,date,text,timestamptz,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.save_retention_opportunity(uuid,uuid,uuid,text,text,text,text,jsonb,numeric,date,text,timestamptz,text,boolean,text)
  to service_role;

comment on function public.convert_won_lead_to_client(uuid,text,text,text,text,date) is
  'Idempotently converts a won lead into one client account, primary stakeholder, and initial delivery project.';
comment on table public.client_activities is
  'Immutable operational audit trail for client, delivery, health, and retention changes.';

commit;
