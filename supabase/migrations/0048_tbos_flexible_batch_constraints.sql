-- Finish the flexible-batch migration for T-BOS.
--
-- Migration 0010 introduced public.batches and tbos_teams.batch_id, but the
-- original Batch 1 / Batch 2 CHECK constraints were still attached to the
-- denormalized snapshots. Any newly named batch therefore failed when a team
-- or its first observation was inserted.

begin;

do $$
begin
  if exists (
    select 1
    from public.tbos_teams
    where batch is null
      or btrim(batch) = ''
      or char_length(batch) > 50
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid T-BOS team batch snapshots exist. Repair them before applying migration 0048.';
  end if;

  if exists (
    select 1
    from public.tbos_observations
    where batch is null
      or btrim(batch) = ''
      or char_length(batch) > 50
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invalid T-BOS observation batch snapshots exist. Repair them before applying migration 0048.';
  end if;
end;
$$;

alter table public.tbos_teams
  drop constraint if exists tbos_teams_batch_check;
alter table public.tbos_teams
  drop constraint if exists tbos_teams_batch_valid;
alter table public.tbos_teams
  add constraint tbos_teams_batch_valid check (
    btrim(batch) <> '' and char_length(batch) <= 50
  );

alter table public.tbos_observations
  drop constraint if exists tbos_observations_batch_check;
alter table public.tbos_observations
  drop constraint if exists tbos_observations_batch_valid;
alter table public.tbos_observations
  add constraint tbos_observations_batch_valid check (
    btrim(batch) <> '' and char_length(batch) <= 50
  );

alter table public.batches
  drop constraint if exists batches_name_valid;
alter table public.batches
  add constraint batches_name_valid check (
    btrim(name) <> '' and char_length(btrim(name)) <= 50
  );

comment on constraint tbos_teams_batch_valid on public.tbos_teams is
  'Flexible batch-name snapshot; the authoritative batch is batch_id.';
comment on constraint tbos_observations_batch_valid on public.tbos_observations is
  'Historical flexible batch-name snapshot copied at observation submission.';

-- Adding several roster members and changing the captain must be one database
-- transaction. A failed insert must never leave the existing roster captainless.
create or replace function public.tbos_add_team_members(
  p_team_id uuid,
  p_members jsonb
)
returns setof public.tbos_team_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_count integer;
  v_valid_count integer;
  v_requested_captains integer;
  v_existing_count integer;
  v_existing_captains integer;
begin
  if p_team_id is null then
    raise exception using errcode = '23503', message = 'Tim tidak ditemukan.';
  end if;

  perform 1 from public.tbos_teams where id = p_team_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'Tim tidak ditemukan.';
  end if;

  if jsonb_typeof(p_members) is distinct from 'array'
    or jsonb_array_length(p_members) not between 1 and 40
  then
    raise exception using errcode = '22023', message = 'Isi 1 sampai 40 anggota tim.';
  end if;

  select count(*),
    count(*) filter (where jsonb_typeof(member->'memberName') = 'string'
      and btrim(member->>'memberName') <> ''
      and char_length(btrim(member->>'memberName')) <= 100
      and jsonb_typeof(member->'isCaptain') = 'boolean'),
    count(*) filter (where jsonb_typeof(member->'isCaptain') = 'boolean'
      and (member->>'isCaptain')::boolean)
  into v_requested_count, v_valid_count, v_requested_captains
  from jsonb_array_elements(p_members) member;

  if v_valid_count <> v_requested_count or v_requested_captains > 1 then
    raise exception using errcode = '22023', message = 'Nama anggota atau pilihan kapten tidak valid.';
  end if;

  if (
    select count(distinct lower(btrim(member->>'memberName')))
    from jsonb_array_elements(p_members) member
  ) <> v_requested_count then
    raise exception using errcode = '23505', message = 'Nama anggota tercantum lebih dari sekali.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_members) requested
    join public.tbos_team_members existing
      on existing.team_id = p_team_id
      and lower(btrim(existing.member_name)) = lower(btrim(requested->>'memberName'))
  ) then
    raise exception using errcode = '23505', message = 'Anggota sudah ada dalam tim.';
  end if;

  select count(*), count(*) filter (where is_captain)
    into v_existing_count, v_existing_captains
  from public.tbos_team_members
  where team_id = p_team_id;

  if v_requested_captains = 1 and v_existing_captains > 0 then
    update public.tbos_team_members
    set is_captain = false
    where team_id = p_team_id and is_captain;
  end if;

  return query
  insert into public.tbos_team_members (team_id, member_name, is_captain)
  select
    p_team_id,
    btrim(requested.member->>'memberName'),
    case
      when v_existing_count = 0 and v_requested_captains = 0 then requested.ordinality = 1
      else (requested.member->>'isCaptain')::boolean
    end
  from jsonb_array_elements(p_members) with ordinality as requested(member, ordinality)
  returning *;
end;
$$;

revoke all on function public.tbos_add_team_members(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.tbos_add_team_members(uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
