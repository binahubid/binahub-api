-- Hardening for the CEO revision: preserve history and make critical writes atomic.

begin;

create extension if not exists pgcrypto;

-- Profiles are rendered in audit trails and must always have a usable name.
update public.profiles
set full_name = 'Pengguna BinaHub'
where full_name is null or btrim(full_name) = '';

alter table public.profiles alter column full_name set not null;
alter table public.profiles drop constraint if exists profiles_full_name_nonempty;
alter table public.profiles add constraint profiles_full_name_nonempty check (btrim(full_name) <> '');

do $$
begin
  if exists (
    select 1 from public.engagements
    where start_date is not null and end_date is not null and start_date > end_date
  ) then
    raise exception using errcode = '23514', message = 'Programs with an end date before their start date exist. Resolve them before applying migration 0015.';
  end if;
end;
$$;
alter table public.engagements drop constraint if exists engagements_date_order;
alter table public.engagements add constraint engagements_date_order
  check (start_date is null or end_date is null or start_date <= end_date);

-- Flexible batches: deterministic ordering and a race-safe creator.
do $$
begin
  if exists (
    select 1
    from public.batches
    group by program_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate batch names exist. Resolve them before applying migration 0015.';
  end if;
end;
$$;

create unique index if not exists batches_unique_name_per_program
  on public.batches (program_id, lower(btrim(name)));

create or replace function public.create_program_batch(
  p_program_id uuid,
  p_name text
)
returns public.batches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.batches;
begin
  if p_program_id is null or p_name is null or btrim(p_name) = '' or char_length(btrim(p_name)) > 50 then
    raise exception using errcode = '22023', message = 'Program dan nama batch yang valid wajib diisi.';
  end if;

  if not exists (
    select 1 from public.program_modules
    where program_id = p_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('batch:' || p_program_id::text, 0));

  insert into public.batches (program_id, name, sort_order)
  select p_program_id, btrim(p_name), coalesce(max(sort_order), 0) + 1
  from public.batches
  where program_id = p_program_id
  returning * into v_batch;

  return v_batch;
end;
$$;

revoke all on function public.create_program_batch(uuid, text) from public, anon, authenticated;
grant execute on function public.create_program_batch(uuid, text) to service_role;

-- Keep the legacy batch snapshot in sync until all older reports have migrated.
create or replace function public.tbos_sync_team_batch_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_name text;
  v_program_id uuid;
begin
  select name, program_id into v_name, v_program_id
  from public.batches
  where id = new.batch_id;

  if not found then
    raise exception using errcode = '23503', message = 'Batch tidak ditemukan.';
  end if;
  if new.engagement_id is distinct from v_program_id then
    raise exception using errcode = '23514', message = 'Batch dan tim harus berada dalam program yang sama.';
  end if;

  new.batch = v_name;
  return new;
end;
$$;

drop trigger if exists tbos_teams_sync_batch_snapshot on public.tbos_teams;
create trigger tbos_teams_sync_batch_snapshot
before insert or update of batch_id, engagement_id on public.tbos_teams
for each row when (new.batch_id is not null)
execute function public.tbos_sync_team_batch_snapshot();

-- A participant profile may belong to only one team inside the same program.
do $$
begin
  if exists (
    select 1
    from public.tbos_team_members member
    join public.tbos_teams team on team.id = member.team_id
    where member.profile_id is not null and team.engagement_id is not null
    group by member.profile_id, team.engagement_id
    having count(distinct member.team_id) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'A participant profile belongs to multiple teams in one program. Resolve it before applying migration 0015.';
  end if;
end;
$$;

create or replace function public.tbos_enforce_single_team_per_program()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program_id uuid;
begin
  if new.profile_id is null then return new; end if;

  select engagement_id into v_program_id
  from public.tbos_teams
  where id = new.team_id;

  if v_program_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('team-membership:' || new.profile_id::text || ':' || v_program_id::text, 0));
  end if;

  if v_program_id is not null and exists (
    select 1
    from public.tbos_team_members member
    join public.tbos_teams team on team.id = member.team_id
    where member.profile_id = new.profile_id
      and team.engagement_id = v_program_id
      and member.team_id <> new.team_id
  ) then
    raise exception using errcode = '23505', message = 'Peserta sudah terdaftar pada tim lain di program ini.';
  end if;

  return new;
end;
$$;

drop trigger if exists tbos_team_members_single_team_per_program on public.tbos_team_members;
create trigger tbos_team_members_single_team_per_program
before insert or update of team_id, profile_id on public.tbos_team_members
for each row execute function public.tbos_enforce_single_team_per_program();

-- Never delete survey history when a speaker is removed from future forms.
alter table public.lep_speakers add column if not exists deleted_at timestamptz;

do $$
begin
  if exists (
    select 1
    from public.lep_speakers
    where deleted_at is null
    group by program_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate active LEP speaker names exist. Resolve them before applying migration 0015.';
  end if;
end;
$$;

create unique index if not exists lep_speakers_unique_active_name
  on public.lep_speakers (program_id, lower(btrim(name)))
  where deleted_at is null;

alter table public.lep_speaker_ratings
  drop constraint if exists lep_speaker_ratings_speaker_id_fkey;
alter table public.lep_speaker_ratings
  add constraint lep_speaker_ratings_speaker_id_fkey
  foreign key (speaker_id) references public.lep_speakers(id) on delete restrict;

create or replace function public.submit_lep_response(
  p_program_id uuid,
  p_profile_id uuid,
  p_q_menyenangkan integer,
  p_q_bermanfaat integer,
  p_q_rekomendasi integer,
  p_q_praktik integer,
  p_hal_terpenting text,
  p_hal_menarik text,
  p_saran_program text,
  p_speaker_ratings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response_id uuid;
  v_active_speakers integer;
  v_valid_ratings integer;
begin
  if not exists (
    select 1 from public.program_modules
    where program_id = p_program_id and module_key = 'lep' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul LEP tidak aktif untuk program ini.';
  end if;

  if not exists (
    select 1
    from public.participants p
    join public.engagement_participants ep on ep.participant_id = p.id
    where p.profile_id = p_profile_id and ep.engagement_id = p_program_id
  ) then
    raise exception using errcode = '42501', message = 'Peserta tidak terdaftar pada program ini.';
  end if;

  if p_q_menyenangkan not between 1 and 4
    or p_q_bermanfaat not between 1 and 4
    or p_q_rekomendasi not between 1 and 4
    or p_q_praktik not between 1 and 4
    or p_hal_terpenting is null or btrim(p_hal_terpenting) = ''
    or p_hal_menarik is null or btrim(p_hal_menarik) = ''
    or char_length(p_hal_terpenting) > 4000
    or char_length(p_hal_menarik) > 4000
    or char_length(coalesce(p_saran_program, '')) > 4000
  then
    raise exception using errcode = '22023', message = 'Jawaban LEP tidak valid.';
  end if;

  if jsonb_typeof(p_speaker_ratings) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Rating pemateri harus berupa array.';
  end if;

  select count(*) into v_active_speakers
  from public.lep_speakers
  where program_id = p_program_id and deleted_at is null;

  begin
    select count(*) into v_valid_ratings
    from jsonb_array_elements(p_speaker_ratings) rating
    join public.lep_speakers speaker
      on speaker.id = (rating->>'speakerId')::uuid
      and speaker.program_id = p_program_id
      and speaker.deleted_at is null
    where jsonb_typeof(rating) = 'object'
      and jsonb_typeof(rating->'speakerId') = 'string'
      and jsonb_typeof(rating->'score') = 'number'
      and (rating->>'score')::numeric = trunc((rating->>'score')::numeric)
      and (rating->>'score')::integer between 1 and 4
      and char_length(coalesce(rating->>'comment', '')) <= 2000;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Rating pemateri tidak valid.';
  end;

  if v_valid_ratings <> v_active_speakers
    or v_valid_ratings <> jsonb_array_length(p_speaker_ratings)
    or (
      select count(distinct rating->>'speakerId')
      from jsonb_array_elements(p_speaker_ratings) rating
    ) <> v_valid_ratings
  then
    raise exception using errcode = '22023', message = 'Setiap pemateri aktif wajib dinilai tepat satu kali.';
  end if;

  insert into public.lep_responses (
    program_id, profile_id, q_menyenangkan, q_bermanfaat,
    q_rekomendasi, q_praktik, hal_terpenting, hal_menarik, saran_program
  ) values (
    p_program_id, p_profile_id, p_q_menyenangkan, p_q_bermanfaat,
    p_q_rekomendasi, p_q_praktik, btrim(p_hal_terpenting), btrim(p_hal_menarik),
    nullif(btrim(coalesce(p_saran_program, '')), '')
  ) returning id into v_response_id;

  insert into public.lep_speaker_ratings (response_id, speaker_id, score, comment)
  select v_response_id, (rating->>'speakerId')::uuid, (rating->>'score')::integer,
    nullif(btrim(coalesce(rating->>'comment', '')), '')
  from jsonb_array_elements(p_speaker_ratings) rating;

  return v_response_id;
end;
$$;

revoke all on function public.submit_lep_response(uuid, uuid, integer, integer, integer, integer, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_lep_response(uuid, uuid, integer, integer, integer, integer, text, text, text, jsonb)
  to service_role;

-- Program becomes an immutable observation snapshot dimension for reporting.
alter table public.tbos_observations add column if not exists program_id uuid references public.engagements(id) on delete restrict;
alter table public.tbos_observations add column if not exists client_submission_id text;

update public.tbos_observations observation
set program_id = team.engagement_id
from public.tbos_teams team
where team.id = observation.team_id and observation.program_id is null;

do $$
begin
  if exists (select 1 from public.tbos_observations where program_id is null) then
    raise exception using
      errcode = '23502',
      message = 'Unscoped T-BOS observations exist. Map their teams to a program before applying migration 0015.';
  end if;
end;
$$;

alter table public.tbos_observations alter column program_id set not null;

create index if not exists tbos_observations_program_idx on public.tbos_observations(program_id);
create unique index if not exists tbos_observations_facilitator_submission_unique
  on public.tbos_observations (profile_id, client_submission_id)
  where client_submission_id is not null;

create table if not exists public.tbos_observation_members (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.tbos_observations(id) on delete cascade,
  team_member_id uuid references public.tbos_team_members(id) on delete set null,
  member_name text not null check (btrim(member_name) <> '' and char_length(member_name) <= 200),
  is_present boolean not null default true,
  is_captain boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tbos_observation_members_observation_idx
  on public.tbos_observation_members (observation_id);
create unique index if not exists tbos_observation_members_source_unique
  on public.tbos_observation_members (observation_id, team_member_id)
  where team_member_id is not null;
create unique index if not exists tbos_observation_members_one_captain
  on public.tbos_observation_members (observation_id)
  where is_captain;

revoke all on table public.tbos_observation_members from anon, authenticated;
grant all on table public.tbos_observation_members to service_role;
alter table public.tbos_observation_members enable row level security;

create or replace function public.tbos_submit_observation_v2(
  p_facilitator_id uuid,
  p_team_id uuid,
  p_program_id uuid,
  p_batch_id uuid,
  p_team_name text,
  p_mission_id uuid,
  p_client_submission_id text,
  p_notes text,
  p_scores jsonb,
  p_members jsonb,
  p_is_admin boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_observation_id uuid;
  v_program_id uuid;
  v_team_id uuid;
  v_team_batch text;
  v_team_organization_id uuid;
  v_expected_count integer;
  v_score_count integer;
  v_member_count integer;
  v_present_count integer;
  v_captain_count integer;
  v_member jsonb;
  v_team_member_id uuid;
  v_source_member_name text;
  v_source_is_captain boolean;
begin
  if p_facilitator_id is null or not exists (select 1 from public.profiles where id = p_facilitator_id) then
    raise exception using errcode = '23503', message = 'Profil fasilitator tidak ditemukan.';
  end if;
  if p_client_submission_id is null or btrim(p_client_submission_id) = '' or char_length(p_client_submission_id) > 128 then
    raise exception using errcode = '22023', message = 'Client submission ID tidak valid.';
  end if;
  if p_notes is not null and char_length(p_notes) > 50 then
    raise exception using errcode = '22023', message = 'Catatan maksimal 50 karakter.';
  end if;
  if (p_team_id is null) = (p_program_id is null or p_batch_id is null or p_team_name is null) then
    raise exception using errcode = '22023', message = 'Pilih tim yang ada atau isi data tim baru secara lengkap.';
  end if;
  if jsonb_typeof(p_scores) is distinct from 'array' or jsonb_typeof(p_members) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Skor dan anggota harus berupa array.';
  end if;

  select id into v_observation_id
  from public.tbos_observations
  where profile_id = p_facilitator_id and client_submission_id = btrim(p_client_submission_id);
  if found then
    if not exists (
      select 1 from public.tbos_observations
      where id = v_observation_id and mission_id = p_mission_id
    ) then
      raise exception using errcode = '22023', message = 'Client submission ID sudah digunakan untuk data berbeda.';
    end if;
    return v_observation_id;
  end if;

  if p_team_id is not null then
    select id, engagement_id, batch, organization_id
      into v_team_id, v_program_id, v_team_batch, v_team_organization_id
    from public.tbos_teams where id = p_team_id for update;
    if not found then
      raise exception using errcode = '23503', message = 'Tim tidak ditemukan.';
    end if;
  else
    if btrim(p_team_name) = '' or char_length(btrim(p_team_name)) > 50 then
      raise exception using errcode = '22023', message = 'Nama tim tidak valid.';
    end if;
    select batch.name, engagement.organization_id
      into v_team_batch, v_team_organization_id
    from public.batches batch
    join public.engagements engagement on engagement.id = batch.program_id
    where batch.id = p_batch_id and batch.program_id = p_program_id;
    if not found then
      raise exception using errcode = '23503', message = 'Batch tidak ditemukan pada program tersebut.';
    end if;
    v_program_id := p_program_id;
  end if;

  if not exists (
    select 1 from public.program_modules
    where program_id = v_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;
  if not coalesce(p_is_admin, false) and not exists (
    select 1 from public.facilitator_missions
    where profile_id = p_facilitator_id and program_id = v_program_id and mission_id = p_mission_id
  ) then
    raise exception using errcode = '42501', message = 'Fasilitator tidak ditugaskan pada misi dan program ini.';
  end if;

  select count(*) into v_expected_count
  from public.tbos_mission_dimensions
  where mission_id = p_mission_id;
  begin
    select count(*) into v_score_count
    from jsonb_array_elements(p_scores) score
    join public.tbos_mission_dimensions md
      on md.mission_id = p_mission_id and md.dimension_id = (score->>'dimensionId')::uuid
    join public.tbos_dimension_levels level
      on level.dimension_id = md.dimension_id and level.level_value = (score->>'levelValue')::integer
    where jsonb_typeof(score) = 'object'
      and jsonb_typeof(score->'dimensionId') = 'string'
      and jsonb_typeof(score->'levelValue') = 'number'
      and (score->>'levelValue')::numeric = trunc((score->>'levelValue')::numeric);
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Skor observasi tidak valid.';
  end;
  if v_expected_count = 0
    or v_score_count <> v_expected_count
    or v_score_count <> jsonb_array_length(p_scores)
    or (select count(distinct score->>'dimensionId') from jsonb_array_elements(p_scores) score) <> v_score_count
  then
    raise exception using errcode = '22023', message = 'Setiap dimensi misi wajib dinilai tepat satu kali.';
  end if;

  begin
    select count(*),
      count(*) filter (where (member->>'isPresent')::boolean),
      count(*) filter (where (member->>'isCaptain')::boolean)
      into v_member_count, v_present_count, v_captain_count
    from jsonb_array_elements(p_members) member
    where jsonb_typeof(member) = 'object'
      and jsonb_typeof(member->'memberName') = 'string'
      and btrim(member->>'memberName') <> ''
      and char_length(member->>'memberName') <= 200
      and jsonb_typeof(member->'isPresent') = 'boolean'
      and jsonb_typeof(member->'isCaptain') = 'boolean'
      and (not (member->>'isCaptain')::boolean or (member->>'isPresent')::boolean);
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'Roster observasi tidak valid.';
  end;
  if v_member_count = 0 or v_member_count <> jsonb_array_length(p_members)
    or v_present_count < 1 or v_captain_count <> 1
  then
    raise exception using errcode = '22023', message = 'Roster wajib memiliki anggota hadir dan tepat satu kapten yang hadir.';
  end if;

  if p_team_id is not null then
    if exists (
      select 1
      from jsonb_array_elements(p_members) member
      left join public.tbos_team_members team_member
        on team_member.id = nullif(member->>'teamMemberId', '')::uuid
        and team_member.team_id = v_team_id
      where team_member.id is null
        or btrim(member->>'memberName') <> btrim(team_member.member_name)
        or (member->>'isCaptain')::boolean is distinct from team_member.is_captain
    ) then
      raise exception using errcode = '23503', message = 'Roster berisi anggota yang tidak terdaftar pada tim.';
    end if;
  else
    if exists (
      select 1 from jsonb_array_elements(p_members) member
      where nullif(member->>'teamMemberId', '') is not null
    ) then
      raise exception using errcode = '22023', message = 'Tim baru tidak boleh mengirim ID anggota lama.';
    end if;
    if (select count(distinct lower(btrim(member->>'memberName'))) from jsonb_array_elements(p_members) member) <> v_member_count then
      raise exception using errcode = '22023', message = 'Nama anggota tim baru harus unik.';
    end if;

    insert into public.tbos_teams (name, batch, batch_id, organization_id, engagement_id)
    values (btrim(p_team_name), v_team_batch, p_batch_id, v_team_organization_id, v_program_id)
    returning id into v_team_id;
  end if;

  insert into public.tbos_observations (
    team_id, program_id, mission_id, profile_id, batch, status, notes, client_submission_id
  ) values (
    v_team_id, v_program_id, p_mission_id, p_facilitator_id, v_team_batch,
    'submitted', nullif(btrim(coalesce(p_notes, '')), ''), btrim(p_client_submission_id)
  ) returning id into v_observation_id;

  insert into public.tbos_observation_scores (observation_id, dimension_id, level_value)
  select v_observation_id, (score->>'dimensionId')::uuid, (score->>'levelValue')::integer
  from jsonb_array_elements(p_scores) score;

  for v_member in select value from jsonb_array_elements(p_members)
  loop
    if p_team_id is null then
      insert into public.tbos_team_members (team_id, member_name, is_captain)
      values (v_team_id, btrim(v_member->>'memberName'), (v_member->>'isCaptain')::boolean)
      returning id into v_team_member_id;
    else
      v_team_member_id := (v_member->>'teamMemberId')::uuid;
      select member_name, is_captain
        into v_source_member_name, v_source_is_captain
      from public.tbos_team_members
      where id = v_team_member_id and team_id = v_team_id;
    end if;

    insert into public.tbos_observation_members (
      observation_id, team_member_id, member_name, is_present, is_captain
    ) values (
      v_observation_id, v_team_member_id,
      case when p_team_id is null then btrim(v_member->>'memberName') else v_source_member_name end,
      (v_member->>'isPresent')::boolean,
      case when p_team_id is null then (v_member->>'isCaptain')::boolean else v_source_is_captain end
    );
  end loop;

  insert into public.tbos_observation_audit_log (
    observation_id, actor_id, actor_role, action, new_status, changes
  ) values (
    v_observation_id, p_facilitator_id,
    case when p_is_admin then 'admin' else 'facilitator' end,
    'create', 'submitted',
    jsonb_build_object('programId', v_program_id, 'teamCreated', p_team_id is null,
      'memberCount', v_member_count, 'presentCount', v_present_count)
  );

  return v_observation_id;
end;
$$;

revoke all on function public.tbos_submit_observation_v2(uuid, uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.tbos_submit_observation_v2(uuid, uuid, uuid, uuid, text, uuid, text, text, jsonb, jsonb, boolean)
  to service_role;

create or replace function public.replace_facilitator_missions(
  p_facilitator_id uuid,
  p_program_id uuid,
  p_mission_ids uuid[]
)
returns setof public.facilitator_missions
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = p_facilitator_id and role = 'facilitator'
  ) then
    raise exception using errcode = '22023', message = 'Akun yang dipilih bukan fasilitator.';
  end if;
  if not exists (
    select 1 from public.program_modules
    where program_id = p_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;
  if coalesce(cardinality(p_mission_ids), 0) <> (
    select count(distinct assigned.mission_id)
    from unnest(coalesce(p_mission_ids, array[]::uuid[])) as assigned(mission_id)
    join public.tbos_missions mission on mission.id = assigned.mission_id
  ) then
    raise exception using errcode = '22023', message = 'Daftar misi tidak valid atau berisi duplikasi.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('assignment:' || p_facilitator_id::text || ':' || p_program_id::text, 0));
  delete from public.facilitator_missions
  where profile_id = p_facilitator_id and program_id = p_program_id;

  insert into public.facilitator_missions (profile_id, program_id, mission_id)
  select p_facilitator_id, p_program_id, assigned.mission_id
  from unnest(coalesce(p_mission_ids, array[]::uuid[])) as assigned(mission_id);

  return query
  select * from public.facilitator_missions
  where profile_id = p_facilitator_id and program_id = p_program_id
  order by mission_id;
end;
$$;

revoke all on function public.replace_facilitator_missions(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.replace_facilitator_missions(uuid, uuid, uuid[]) to service_role;

commit;
