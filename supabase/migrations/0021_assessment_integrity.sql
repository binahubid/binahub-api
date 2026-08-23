-- Prevent duplicate public assessment processing and enforce score boundaries.

begin;

alter table public.assessments
  add column if not exists submission_key_hash text;

create unique index if not exists assessments_submission_key_unique_idx
  on public.assessments (submission_key_hash)
  where submission_key_hash is not null;

alter table public.assessments
  drop constraint if exists assessments_submission_key_hash_format;
alter table public.assessments
  add constraint assessments_submission_key_hash_format
  check (submission_key_hash is null or submission_key_hash ~ '^[0-9a-f]{64}$') not valid;

alter table public.assessments
  drop constraint if exists assessments_overall_score_range;
alter table public.assessments
  add constraint assessments_overall_score_range
  check (overall_score is null or overall_score between 0 and 100) not valid;

alter table public.leads
  drop constraint if exists leads_score_range;
alter table public.leads
  add constraint leads_score_range
  check (lead_score is null or lead_score between 0 and 100) not valid;

commit;
