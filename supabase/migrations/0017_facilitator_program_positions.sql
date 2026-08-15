-- One facilitator is assigned to a T-BOS program, then chooses one permanent
-- mission/position for the lifetime of the active program.

begin;

create table if not exists public.facilitator_program_assignments (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  program_id uuid not null references public.engagements(id) on delete cascade,
  selected_mission_id uuid references public.tbos_missions(id) on delete restrict,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  selected_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, program_id),
  constraint facilitator_program_assignment_selection_time check (
    (selected_mission_id is null and selected_at is null)
    or (selected_mission_id is not null and selected_at is not null)
  )
);

comment on table public.facilitator_program_assignments is
  'Program-level T-BOS assignment. The facilitator chooses one mission/position, which is locked while the program is unfinished.';

create index if not exists facilitator_program_assignments_program_idx
  on public.facilitator_program_assignments (program_id);
create index if not exists facilitator_program_assignments_selected_mission_idx
  on public.facilitator_program_assignments (selected_mission_id)
  where selected_mission_id is not null;
create unique index if not exists facilitator_program_one_facilitator_per_position
  on public.facilitator_program_assignments (program_id, selected_mission_id)
  where selected_mission_id is not null;

alter table public.tbos_teams
  add column if not exists roster_initialized_by uuid references public.profiles(id) on delete set null,
  add column if not exists roster_initialized_at timestamptz;

comment on column public.tbos_teams.roster_initialized_by is
  'Facilitator who claimed the initially empty roster during the first station visit.';
comment on column public.tbos_teams.roster_initialized_at is
  'Set after the first observation; the shared master roster becomes read-only for facilitators.';

-- Repair legacy non-empty rosters that predate the captain requirement.
update public.tbos_team_members member
set is_captain = true
where member.id in (
  select (
    select first_member.id
    from public.tbos_team_members first_member
    where first_member.team_id = team.id
    order by first_member.id
    limit 1
  )
  from public.tbos_teams team
  where exists (select 1 from public.tbos_team_members existing where existing.team_id = team.id)
    and not exists (
      select 1 from public.tbos_team_members captain
      where captain.team_id = team.id and captain.is_captain
    )
);

-- Existing non-empty rosters are already authoritative and must not be claimed
-- or modified by a later station visit.
update public.tbos_teams team
set roster_initialized_at = coalesce(team.roster_initialized_at, now())
where team.roster_initialized_at is null
  and exists (select 1 from public.tbos_team_members member where member.team_id = team.id);

alter table public.app_client_access_codes
  add column if not exists program_id uuid references public.engagements(id) on delete cascade;
create index if not exists app_client_access_codes_program_idx
  on public.app_client_access_codes (program_id);

-- Older participant codes can be scoped safely only when that participant is
-- linked to exactly one program. Ambiguous legacy codes keep program_id null.
update public.app_client_access_codes access_code
set program_id = (
  select min(membership.engagement_id::text)::uuid
  from public.engagement_participants membership
  where membership.participant_id = access_code.participant_id
)
where access_code.program_id is null
  and access_code.participant_id is not null
  and 1 = (
    select count(distinct membership.engagement_id)
    from public.engagement_participants membership
    where membership.participant_id = access_code.participant_id
  );

-- Preserve unambiguous legacy assignments. A legacy assignment containing more
-- than one mission represented the former "all missions" behavior and must be
-- returned to an unselected state instead of choosing a position arbitrarily.
with grouped_legacy as (
  select
    assignment.profile_id,
    assignment.program_id,
    count(*) as mission_count,
    min(assignment.mission_id::text)::uuid as only_mission_id,
    min(assignment.created_at) as first_assigned_at
  from public.facilitator_missions assignment
  group by assignment.profile_id, assignment.program_id
), classified_legacy as (
  select grouped_legacy.*,
    count(*) over (partition by program_id, only_mission_id) as mission_claim_count
  from grouped_legacy
)
insert into public.facilitator_program_assignments (
  profile_id,
  program_id,
  selected_mission_id,
  assigned_at,
  selected_at,
  updated_at
)
select
  assignment.profile_id,
  assignment.program_id,
  case when assignment.mission_count = 1 and assignment.mission_claim_count = 1 then assignment.only_mission_id else null end,
  assignment.first_assigned_at,
  case when assignment.mission_count = 1 and assignment.mission_claim_count = 1 then assignment.first_assigned_at else null end,
  now()
from classified_legacy assignment
on conflict (profile_id, program_id) do nothing;

-- facilitator_missions remains a compatibility authorization mirror, but it may
-- contain only the single selected position from this point forward.
delete from public.facilitator_missions;
insert into public.facilitator_missions (profile_id, program_id, mission_id, created_at)
select profile_id, program_id, selected_mission_id, coalesce(selected_at, assigned_at)
from public.facilitator_program_assignments
where selected_mission_id is not null
on conflict (profile_id, mission_id, program_id) do nothing;

alter table public.facilitator_program_assignments enable row level security;
revoke all on table public.facilitator_program_assignments from public, anon, authenticated;
grant all on table public.facilitator_program_assignments to service_role;

create or replace function public.assign_facilitator_program(
  p_facilitator_id uuid,
  p_program_id uuid,
  p_assigned_by uuid
)
returns public.facilitator_program_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.facilitator_program_assignments;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_facilitator_id and role = 'facilitator'
  ) then
    raise exception using errcode = '22023', message = 'Akun yang dipilih bukan fasilitator.';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_assigned_by and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Hanya admin yang dapat menugaskan fasilitator.';
  end if;
  if not exists (
    select 1 from public.program_modules
    where program_id = p_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'facilitator-program:' || p_facilitator_id::text || ':' || p_program_id::text, 0
  ));

  insert into public.facilitator_program_assignments (
    profile_id, program_id, assigned_by
  ) values (
    p_facilitator_id, p_program_id, p_assigned_by
  )
  on conflict (profile_id, program_id) do update
    set assigned_by = coalesce(public.facilitator_program_assignments.assigned_by, excluded.assigned_by),
        updated_at = now()
  returning * into v_assignment;

  return v_assignment;
end;
$$;

revoke all on function public.assign_facilitator_program(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_facilitator_program(uuid, uuid, uuid)
  to service_role;

create or replace function public.select_facilitator_program_mission(
  p_facilitator_id uuid,
  p_program_id uuid,
  p_mission_id uuid
)
returns public.facilitator_program_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assignment public.facilitator_program_assignments;
  v_program_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'facilitator-program:' || p_facilitator_id::text || ':' || p_program_id::text, 0
  ));

  select assignment.*
    into v_assignment
  from public.facilitator_program_assignments assignment
  join public.engagements engagement on engagement.id = assignment.program_id
  where assignment.profile_id = p_facilitator_id
    and assignment.program_id = p_program_id
  for update of assignment;

  if not found then
    raise exception using errcode = '42501', message = 'Fasilitator belum ditugaskan ke program ini.';
  end if;

  select engagement.status
    into v_program_status
  from public.engagements engagement
  where engagement.id = p_program_id;

  if not exists (select 1 from public.tbos_missions where id = p_mission_id) then
    raise exception using errcode = '23503', message = 'Misi T-BOS tidak ditemukan.';
  end if;
  if v_assignment.selected_mission_id = p_mission_id then
    return v_assignment;
  end if;
  if v_assignment.selected_mission_id is not null
    and v_program_status not in ('completed', 'archived')
  then
    raise exception using errcode = '42501', message = 'Pos sudah dikunci dan tidak dapat diubah sampai program selesai.';
  end if;

  update public.facilitator_program_assignments
  set selected_mission_id = p_mission_id,
      selected_at = now(),
      updated_at = now()
  where profile_id = p_facilitator_id and program_id = p_program_id
  returning * into v_assignment;

  delete from public.facilitator_missions
  where profile_id = p_facilitator_id and program_id = p_program_id;
  insert into public.facilitator_missions (profile_id, program_id, mission_id)
  values (p_facilitator_id, p_program_id, p_mission_id);

  return v_assignment;
end;
$$;

revoke all on function public.select_facilitator_program_mission(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.select_facilitator_program_mission(uuid, uuid, uuid)
  to service_role;

create or replace function public.remove_facilitator_program_assignment(
  p_facilitator_id uuid,
  p_program_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'facilitator-program:' || p_facilitator_id::text || ':' || p_program_id::text, 0
  ));
  delete from public.facilitator_missions
  where profile_id = p_facilitator_id and program_id = p_program_id;
  delete from public.facilitator_program_assignments
  where profile_id = p_facilitator_id and program_id = p_program_id;
  update public.tbos_teams
  set roster_initialized_by = null
  where engagement_id = p_program_id
    and roster_initialized_by = p_facilitator_id
    and roster_initialized_at is null;
end;
$$;

revoke all on function public.remove_facilitator_program_assignment(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_facilitator_program_assignment(uuid, uuid)
  to service_role;

commit;
