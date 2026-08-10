-- T-BOS programs use the existing global engagements table.
-- Teams remain nullable during rollout so existing T-BOS data is not deleted.

begin;

alter table public.engagements
  add column if not exists code text;

create unique index if not exists engagements_code_unique_idx
  on public.engagements (lower(code))
  where code is not null;

alter table public.tbos_teams
  add column if not exists engagement_id uuid references public.engagements(id) on delete restrict;

create index if not exists tbos_teams_engagement_idx
  on public.tbos_teams (engagement_id);

comment on column public.engagements.code is 'Business-facing unique program code.';
comment on column public.tbos_teams.engagement_id is 'Global program/engagement that owns this T-BOS team.';

commit;
