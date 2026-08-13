-- Prompt 2: Replace tbos_facilitator_teams with facilitator_missions.
-- Facilitators are now scoped to missions per program, not specific teams.

begin;

-- 1. Create new table
create table if not exists public.facilitator_missions (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  mission_id uuid not null references public.tbos_missions(id) on delete cascade,
  program_id uuid not null references public.engagements(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, mission_id, program_id)
);

comment on table public.facilitator_missions is 'Facilitator-to-mission assignment per program. Replaces tbos_facilitator_teams.';
create index if not exists facilitator_missions_profile_idx on public.facilitator_missions (profile_id);
create index if not exists facilitator_missions_program_idx on public.facilitator_missions (program_id);

-- 2. Migrate existing data from tbos_facilitator_teams
-- For each facilitator-team pair, assign them to ALL missions in that team's program
with team_programs as (
  select distinct ft.profile_id, t.engagement_id as program_id
  from public.tbos_facilitator_teams ft
  join public.tbos_teams t on t.id = ft.team_id
  where t.engagement_id is not null
),
all_missions as (
  select id as mission_id from public.tbos_missions
)
insert into public.facilitator_missions (profile_id, mission_id, program_id)
select distinct tp.profile_id, am.mission_id, tp.program_id
from team_programs tp
cross join all_missions am
on conflict do nothing;

-- 3. Drop old table
drop table if exists public.tbos_facilitator_teams;

commit;
