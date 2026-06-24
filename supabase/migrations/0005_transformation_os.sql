create extension if not exists "pgcrypto";

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  name text not null,
  industry text,
  size text,
  created_at timestamptz not null default now()
);

alter table if exists public.organizations
  add column if not exists tenant_id uuid references public.tenants(id) on delete set null,
  add column if not exists industry text,
  add column if not exists size text;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client'
    check (role in ('admin', 'facilitator', 'client')),
  organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table if exists public.profiles
  add column if not exists full_name text,
  add column if not exists role text not null default 'client'
    check (role in ('admin', 'facilitator', 'client')),
  add column if not exists organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  type text not null check (type in ('assessment', 'coaching', 'training', 'transformation')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'in_progress', 'review', 'completed', 'archived')),
  start_date date,
  end_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text,
  role_title text,
  department text,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists public.engagement_participants (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  role text not null default 'participant' check (role in ('participant', 'leader', 'observer')),
  assigned_at timestamptz not null default now(),
  unique (engagement_id, participant_id)
);

create table if not exists public.facilitators (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  name text not null,
  email text unique,
  specialization text,
  created_at timestamptz not null default now()
);

create table if not exists public.engagement_facilitators (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  facilitator_id uuid not null references public.facilitators(id) on delete cascade,
  role text not null default 'lead' check (role in ('lead', 'assistant')),
  assigned_at timestamptz not null default now(),
  unique (engagement_id, facilitator_id)
);

create table if not exists public.capabilities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  type text not null check (
    type in ('assessment', 'reflection', 'observation', 'feedback', 'coaching_note', 'action_completion', 'survey')
  ),
  source text not null check (source in ('participant', 'facilitator', 'manager', 'system')),
  content jsonb not null default '{}'::jsonb,
  capability_tags text[] not null default '{}',
  confidence_score numeric(4,3) not null default 0.500 check (confidence_score >= 0 and confidence_score <= 1),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  due_date date,
  progress int not null default 0 check (progress >= 0 and progress <= 100),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reflections (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  engagement_id uuid not null references public.engagements(id) on delete cascade,
  question text not null,
  answer text not null,
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.participant_capabilities (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  score numeric(5,2) not null default 0 check (score >= 0 and score <= 100),
  trend text not null default 'stable' check (trend in ('up', 'down', 'stable')),
  evidence_count int not null default 0,
  last_event_id uuid,
  last_updated timestamptz not null default now(),
  unique (participant_id, capability_id)
);

create table if not exists public.capability_evidence (
  id uuid primary key default gen_random_uuid(),
  capability_id uuid not null references public.capabilities(id) on delete cascade,
  evidence_id uuid not null references public.evidence(id) on delete cascade,
  weight numeric(5,2) not null default 1,
  created_at timestamptz not null default now(),
  unique (capability_id, evidence_id)
);

create table if not exists public.outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid references public.engagements(id) on delete cascade,
  name text not null,
  metric_value numeric,
  target_value numeric,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid references public.engagements(id) on delete cascade,
  title text not null,
  summary text not null,
  type text not null check (type in ('risk', 'improvement', 'recommendation')),
  evidence_links uuid[] not null default '{}',
  confidence_score numeric(4,3) not null default 0.500 check (confidence_score >= 0 and confidence_score <= 1),
  created_by_event_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_generation_logs (
  id uuid primary key default gen_random_uuid(),
  input_type text not null,
  input_id uuid,
  output_type text,
  output_id uuid,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_queue (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  engagement_id uuid references public.engagements(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  error_message text,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists engagements_org_status_idx on public.engagements (organization_id, status);
create index if not exists participants_org_idx on public.participants (organization_id);
create index if not exists evidence_engagement_idx on public.evidence (engagement_id, created_at desc);
create index if not exists evidence_participant_idx on public.evidence (participant_id, created_at desc);
create index if not exists actions_engagement_idx on public.actions (engagement_id, status);
create index if not exists actions_participant_idx on public.actions (participant_id, status);
create index if not exists participant_capabilities_participant_idx on public.participant_capabilities (participant_id);
create index if not exists reflections_participant_idx on public.reflections (participant_id, created_at desc);
create index if not exists event_queue_status_idx on public.event_queue (status, available_at, created_at);

create or replace function public.set_transformation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists engagements_set_updated_at on public.engagements;
create trigger engagements_set_updated_at
before update on public.engagements
for each row execute function public.set_transformation_updated_at();

drop trigger if exists actions_set_updated_at on public.actions;
create trigger actions_set_updated_at
before update on public.actions
for each row execute function public.set_transformation_updated_at();

create or replace function public.enqueue_transformation_event(
  p_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_engagement_id uuid,
  p_participant_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
as $$
declare
  inserted_id uuid;
begin
  insert into public.event_queue (
    type,
    aggregate_type,
    aggregate_id,
    engagement_id,
    participant_id,
    payload
  )
  values (
    p_type,
    p_aggregate_type,
    p_aggregate_id,
    p_engagement_id,
    p_participant_id,
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into inserted_id;

  return inserted_id;
end;
$$;

create or replace function public.transformation_core_event_trigger()
returns trigger
language plpgsql
security definer
as $$
declare
  event_type text;
  aggregate_type text;
  engagement uuid;
  participant uuid;
  aggregate uuid;
  payload jsonb;
begin
  if tg_table_name = 'engagements' then
    aggregate_type := 'engagement';
    aggregate := new.id;
    engagement := new.id;
    participant := null;
    event_type := case when tg_op = 'INSERT' then 'EngagementCreated' else 'EngagementUpdated' end;
  elsif tg_table_name = 'engagement_participants' then
    aggregate_type := 'engagement_participant';
    aggregate := new.id;
    engagement := new.engagement_id;
    participant := new.participant_id;
    event_type := 'ParticipantAssigned';
  elsif tg_table_name = 'evidence' then
    aggregate_type := 'evidence';
    aggregate := new.id;
    engagement := new.engagement_id;
    participant := new.participant_id;
    event_type := 'EvidenceCreated';
  elsif tg_table_name = 'actions' then
    aggregate_type := 'action';
    aggregate := new.id;
    engagement := new.engagement_id;
    participant := new.participant_id;
    event_type := case when tg_op = 'INSERT' then 'ActionCreated' else 'ActionUpdated' end;
  elsif tg_table_name = 'insights' then
    aggregate_type := 'insight';
    aggregate := new.id;
    engagement := new.engagement_id;
    participant := null;
    event_type := 'InsightGenerated';
  else
    return new;
  end if;

  payload := jsonb_build_object(
    'operation', tg_op,
    'table', tg_table_name,
    'record', to_jsonb(new)
  );

  perform public.enqueue_transformation_event(event_type, aggregate_type, aggregate, engagement, participant, payload);
  return new;
end;
$$;

drop trigger if exists engagements_emit_event on public.engagements;
create trigger engagements_emit_event
after insert or update on public.engagements
for each row execute function public.transformation_core_event_trigger();

drop trigger if exists engagement_participants_emit_event on public.engagement_participants;
create trigger engagement_participants_emit_event
after insert on public.engagement_participants
for each row execute function public.transformation_core_event_trigger();

drop trigger if exists evidence_emit_event on public.evidence;
create trigger evidence_emit_event
after insert on public.evidence
for each row execute function public.transformation_core_event_trigger();

drop trigger if exists actions_emit_event on public.actions;
create trigger actions_emit_event
after insert or update on public.actions
for each row execute function public.transformation_core_event_trigger();

drop trigger if exists insights_emit_event on public.insights;
create trigger insights_emit_event
after insert on public.insights
for each row execute function public.transformation_core_event_trigger();

insert into public.capabilities (name, description)
values
  ('Leadership', 'Ability to guide people through ambiguity and change.'),
  ('Communication', 'Ability to create shared understanding and useful feedback loops.'),
  ('Collaboration', 'Ability to work across roles and sustain trust.'),
  ('Execution', 'Ability to turn intent into consistent action and follow-through.'),
  ('Strategic Thinking', 'Ability to connect decisions with long-term organizational context.')
on conflict (name) do nothing;

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on
  public.tenants,
  public.organizations,
  public.engagements,
  public.participants,
  public.engagement_participants,
  public.facilitators,
  public.engagement_facilitators,
  public.capabilities,
  public.evidence,
  public.actions,
  public.reflections,
  public.participant_capabilities,
  public.capability_evidence,
  public.outcomes,
  public.insights,
  public.ai_generation_logs,
  public.event_queue
to service_role;

grant select on
  public.engagements,
  public.participants,
  public.engagement_participants,
  public.facilitators,
  public.engagement_facilitators,
  public.capabilities,
  public.evidence,
  public.actions,
  public.participant_capabilities,
  public.capability_evidence,
  public.outcomes,
  public.insights,
  public.event_queue
to authenticated;
