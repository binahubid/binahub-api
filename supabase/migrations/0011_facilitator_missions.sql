-- Add mission-scoped assignments while preserving the former team assignments
-- as immutable history. Historical team ownership cannot be safely inferred as
-- mission ownership, so this migration intentionally performs no cross-join.

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

comment on table public.tbos_facilitator_teams is
  'Legacy facilitator-to-team assignments retained for historical audit only. New flows use facilitator_missions.';

commit;
