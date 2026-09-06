-- Phase 18 multi-provider extension. Apollo remains ready for a paid plan,
-- Hunter supports free company discovery, and manual uploads stay on the
-- existing governed acquisition path.

begin;

alter table public.acquisition_sources
  drop constraint if exists acquisition_sources_provider_valid;
alter table public.acquisition_sources
  add constraint acquisition_sources_provider_valid check (
    provider_type in ('manual_upload', 'website', 'google_ads', 'meta_ads', 'microsoft_ads', 'apollo', 'hunter', 'linkedin', 'google_maps', 'referral', 'partner', 'other')
  );

alter table public.lead_discovery_runs
  drop constraint if exists lead_discovery_runs_provider_valid;
alter table public.lead_discovery_runs
  add constraint lead_discovery_runs_provider_valid check (provider in ('apollo', 'hunter'));
alter table public.lead_discovery_runs
  add column if not exists company_review_count integer not null default 0;
alter table public.lead_discovery_runs
  drop constraint if exists lead_discovery_runs_company_review_count_valid;
alter table public.lead_discovery_runs
  add constraint lead_discovery_runs_company_review_count_valid check (company_review_count >= 0);

alter table public.lead_discovery_candidates
  drop constraint if exists lead_discovery_candidates_provider_valid;
alter table public.lead_discovery_candidates
  add constraint lead_discovery_candidates_provider_valid check (provider in ('apollo', 'hunter'));
alter table public.lead_discovery_candidates
  add column if not exists candidate_kind text not null default 'person';
alter table public.lead_discovery_candidates
  add column if not exists employee_range text;
alter table public.lead_discovery_candidates
  drop constraint if exists lead_discovery_candidates_kind_valid;
alter table public.lead_discovery_candidates
  add constraint lead_discovery_candidates_kind_valid check (candidate_kind in ('company', 'person'));
alter table public.lead_discovery_candidates
  drop constraint if exists lead_discovery_candidates_status_valid;
alter table public.lead_discovery_candidates
  add constraint lead_discovery_candidates_status_valid check (
    status in ('discovered', 'company_review', 'eligible', 'excluded', 'duplicate', 'suppressed', 'no_work_email', 'staged')
  );

comment on column public.lead_discovery_candidates.candidate_kind is
  'Company means free discovery evidence only; person means a decision maker candidate is available.';
comment on column public.lead_discovery_runs.company_review_count is
  'Companies discovered without a reviewed decision-maker contact.';

commit;
