-- Phase 18: governed AI lead discovery. Discovery never sends outreach and
-- every eligible record still enters the existing acquisition batch review.

begin;

create table if not exists public.lead_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  provider text not null,
  status text not null default 'running',
  dry_run boolean not null default true,
  source_id uuid references public.acquisition_sources(id) on delete set null,
  campaign_id uuid references public.acquisition_campaigns(id) on delete set null,
  business_rule_set_id uuid references public.business_rule_sets(id) on delete set null,
  query_snapshot jsonb not null default '{}'::jsonb,
  configuration_snapshot jsonb not null default '{}'::jsonb,
  discovered_count integer not null default 0,
  enriched_count integer not null default 0,
  eligible_count integer not null default 0,
  staged_count integer not null default 0,
  duplicate_count integer not null default 0,
  suppressed_count integer not null default 0,
  no_work_email_count integer not null default 0,
  batch_id uuid references public.prospect_import_batches(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  triggered_by text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lead_discovery_runs_provider_valid check (provider in ('apollo')),
  constraint lead_discovery_runs_status_valid check (status in ('running', 'succeeded', 'partial', 'failed', 'deferred')),
  constraint lead_discovery_runs_key_valid check (length(btrim(idempotency_key)) between 8 and 200),
  constraint lead_discovery_runs_actor_valid check (length(btrim(triggered_by)) between 3 and 320),
  constraint lead_discovery_runs_counts_valid check (
    discovered_count >= 0 and enriched_count >= 0 and eligible_count >= 0
    and staged_count >= 0 and duplicate_count >= 0
    and suppressed_count >= 0 and no_work_email_count >= 0
  ),
  constraint lead_discovery_runs_query_object check (jsonb_typeof(query_snapshot) = 'object'),
  constraint lead_discovery_runs_config_object check (jsonb_typeof(configuration_snapshot) = 'object'),
  constraint lead_discovery_runs_summary_object check (jsonb_typeof(summary) = 'object')
);

create index if not exists lead_discovery_runs_started_idx
  on public.lead_discovery_runs (started_at desc);
create index if not exists lead_discovery_runs_status_idx
  on public.lead_discovery_runs (status, started_at desc);

create table if not exists public.lead_discovery_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid not null references public.lead_discovery_runs(id) on delete cascade,
  provider text not null,
  provider_person_id text not null,
  provider_organization_id text,
  full_name text not null,
  role_title text,
  company text,
  company_domain text,
  industry text,
  location text,
  employee_count integer,
  work_email text,
  email_status text,
  linkedin_url text,
  source_url text,
  fit_score integer not null,
  confidence numeric(4,3) not null,
  status text not null,
  match_reasons jsonb not null default '[]'::jsonb,
  exclusion_reasons jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  ai_reasoning text,
  ai_score_adjustment integer not null default 0,
  acquisition_batch_id uuid references public.prospect_import_batches(id) on delete set null,
  acquisition_prospect_id uuid references public.acquisition_prospects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_discovery_candidates_provider_valid check (provider in ('apollo')),
  constraint lead_discovery_candidates_person_valid check (length(btrim(provider_person_id)) between 1 and 300),
  constraint lead_discovery_candidates_name_valid check (length(btrim(full_name)) between 1 and 300),
  constraint lead_discovery_candidates_score_valid check (fit_score between 0 and 100),
  constraint lead_discovery_candidates_confidence_valid check (confidence between 0 and 1),
  constraint lead_discovery_candidates_adjustment_valid check (ai_score_adjustment between -10 and 10),
  constraint lead_discovery_candidates_status_valid check (
    status in ('discovered', 'eligible', 'excluded', 'duplicate', 'suppressed', 'no_work_email', 'staged')
  ),
  constraint lead_discovery_candidates_match_array check (jsonb_typeof(match_reasons) = 'array'),
  constraint lead_discovery_candidates_exclusion_array check (jsonb_typeof(exclusion_reasons) = 'array'),
  constraint lead_discovery_candidates_evidence_object check (jsonb_typeof(evidence) = 'object'),
  unique (discovery_run_id, provider, provider_person_id)
);

create index if not exists lead_discovery_candidates_run_idx
  on public.lead_discovery_candidates (discovery_run_id, status, fit_score desc);
create index if not exists lead_discovery_candidates_provider_person_idx
  on public.lead_discovery_candidates (provider, provider_person_id, created_at desc);
create index if not exists lead_discovery_candidates_email_idx
  on public.lead_discovery_candidates (lower(work_email)) where work_email is not null;

drop trigger if exists lead_discovery_candidates_set_updated_at on public.lead_discovery_candidates;
create trigger lead_discovery_candidates_set_updated_at
before update on public.lead_discovery_candidates
for each row execute function public.set_updated_at();

alter table public.lead_discovery_runs enable row level security;
alter table public.lead_discovery_candidates enable row level security;

revoke all on table public.lead_discovery_runs, public.lead_discovery_candidates
from public, anon, authenticated;
grant select, insert, update on table public.lead_discovery_runs to service_role;
grant select, insert, update on table public.lead_discovery_candidates to service_role;

comment on table public.lead_discovery_runs is
  'Audited provider discovery runs. No row in this table authorizes outreach.';
comment on table public.lead_discovery_candidates is
  'Provider candidates scored against governed ICP; staging remains subject to acquisition human review.';

commit;
