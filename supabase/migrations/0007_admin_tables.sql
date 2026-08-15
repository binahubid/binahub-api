-- 0007: Admin tables and T-BOS program ownership.
-- These tables are used by the admin dashboard and assessment flow.

alter table public.engagements add column if not exists code text;
create unique index if not exists engagements_code_unique_idx
  on public.engagements (lower(code)) where code is not null;

alter table public.tbos_teams
  add column if not exists engagement_id uuid references public.engagements(id) on delete restrict;
create index if not exists tbos_teams_engagement_idx on public.tbos_teams (engagement_id);

comment on column public.engagements.code is 'Business-facing unique program code.';
comment on column public.tbos_teams.engagement_id is 'Global program/engagement that owns this T-BOS team.';

-- ============================================================
-- LEADS
-- ============================================================
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique not null,
  company text,
  phone text,
  source text,
  lead_score integer,
  lead_status text default 'new',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists leads_email_idx on public.leads (email);
create index if not exists leads_status_idx on public.leads (lead_status);

-- ============================================================
-- ASSESSMENTS
-- ============================================================
create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  form_data jsonb not null default '{}'::jsonb,
  scores jsonb,
  category text,
  ai_analysis text,
  recommendations jsonb,
  overall_score numeric(5,2),

  assessment_status text default 'Belum Dikirim',
  result_email_id text,
  result_email_sent_at timestamptz,
  result_follow_up_level integer default 0,
  result_follow_up_sent_at timestamptz,
  result_follow_up_email_id text,

  proposal_status text default 'Belum Diminta',
  proposal_requested_at timestamptz,
  proposal_sent_at timestamptz,
  proposal_email_id text,
  proposal_data jsonb,
  proposal_follow_up_level integer default 0,
  proposal_follow_up_sent_at timestamptz,
  proposal_follow_up_email_id text,

  follow_up_history jsonb default '[]'::jsonb,
  follow_up_paused boolean default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assessments_lead_idx on public.assessments (lead_id);
create index if not exists assessments_status_idx on public.assessments (assessment_status);

drop trigger if exists assessments_set_updated_at on public.assessments;
create trigger assessments_set_updated_at
before update on public.assessments
for each row execute function public.set_transformation_updated_at();

-- ============================================================
-- INQUIRIES
-- ============================================================
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete set null,
  name text not null,
  email text not null,
  whatsapp text,
  message text,
  source text default 'contact_form',
  status text default 'Baru',
  admin_notes text,

  follow_up_level integer default 0,
  follow_up_last_sent_at timestamptz,
  follow_up_history jsonb default '[]'::jsonb,
  follow_up_paused boolean default false,

  created_at timestamptz not null default now()
);

create index if not exists inquiries_status_idx on public.inquiries (status);
create index if not exists inquiries_created_idx on public.inquiries (created_at desc);

-- ============================================================
-- COACHES
-- ============================================================
create table if not exists public.coaches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text,
  expertise text,
  field text,
  status text default 'active',
  bio text,
  category text,
  rate text,
  availability text,
  cv_url text,
  linkedin_url text,
  linkedin_summary text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- EMPLOYEES
-- ============================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text unique,
  phone text,
  role text,
  department text,
  status text default 'active',
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- COACH ASSIGNMENTS
-- ============================================================
create table if not exists public.coach_assignments (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade,
  client_name text,
  program_name text,
  service text,
  status text default 'active',
  start_date date,
  end_date date,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists coach_assignments_coach_idx on public.coach_assignments (coach_id);

-- ============================================================
-- COACH SESSIONS
-- ============================================================
create table if not exists public.coach_sessions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade,
  assignment_id uuid references public.coach_assignments(id) on delete set null,
  session_date date,
  duration_minutes integer,
  topic text,
  rating integer,
  evaluation text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists coach_sessions_coach_idx on public.coach_sessions (coach_id);

-- ============================================================
-- COACH AVAILABILITY
-- ============================================================
create table if not exists public.coach_availability (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade,
  day_of_week text,
  time_window text,
  mode text,
  status text default 'available',
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- COACH DOCUMENTS
-- ============================================================
create table if not exists public.coach_documents (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid references public.coaches(id) on delete cascade,
  title text not null,
  document_type text,
  document_url text,
  status text default 'active',
  expiry_date date,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PROJECTS
-- ============================================================
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_name text,
  contact_name text,
  contact_email text,
  service text,
  program_name text,
  project_type text,
  scope text,
  budget_note text,
  start_date date,
  end_date date,
  status text default 'planning',
  ai_summary text,
  automation_mode text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PROJECT ASSIGNMENTS
-- ============================================================
create table if not exists public.project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  associate_id uuid,
  associate_name text,
  associate_email text,
  role_title text,
  status text default 'pending',
  match_score numeric(5,2),
  match_reason text,
  invitation_sent_at timestamptz,
  agreement_status text,
  created_at timestamptz not null default now()
);

create index if not exists project_assignments_project_idx on public.project_assignments (project_id);

-- ============================================================
-- SMART ACTIONS
-- ============================================================
create table if not exists public.smart_actions (
  id uuid primary key default gen_random_uuid(),
  action_type text,
  title text,
  description text,
  target_type text,
  target_id uuid,
  priority text default 'medium',
  status text default 'pending',
  mode text,
  due_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FOLLOW-UP EVENTS
-- ============================================================
create table if not exists public.follow_up_events (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  channel text not null,
  level integer not null,
  status text,
  email_id text,
  actor text,
  sent_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists follow_up_events_target_idx on public.follow_up_events (target_type, target_id);

-- ============================================================
-- EMAIL FAILURES (for retry)
-- ============================================================
create table if not exists public.email_failures (
  id uuid primary key default gen_random_uuid(),
  target_type text not null,
  target_id uuid not null,
  error text,
  retry_count integer default 0,
  max_retries integer default 3,
  last_retry_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_failures_target_idx on public.email_failures (target_type, target_id);
