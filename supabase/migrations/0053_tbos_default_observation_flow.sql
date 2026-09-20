-- Remove mission selection from the default facilitator journey while keeping
-- a stable internal mission key for historical compatibility.

begin;

do $$
declare
  v_mission_id uuid;
begin
  select id into v_mission_id from public.tbos_missions where code = 'program_observation';

  update public.facilitator_program_assignments
  set selected_mission_id = v_mission_id,
      selected_at = coalesce(selected_at, now()),
      updated_at = now();

  insert into public.facilitator_missions (profile_id, program_id, mission_id, created_at)
  select profile_id, program_id, v_mission_id, coalesce(selected_at, assigned_at)
  from public.facilitator_program_assignments
  on conflict (profile_id, mission_id, program_id) do nothing;
end;
$$;

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
  v_mission_id uuid;
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

  select id into v_mission_id from public.tbos_missions where code = 'program_observation';
  if v_mission_id is null then
    raise exception using errcode = '23503', message = 'Konteks observasi default T-BOS belum tersedia.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'facilitator-program:' || p_facilitator_id::text || ':' || p_program_id::text, 0
  ));

  insert into public.tbos_program_configurations (
    program_id, observation_mission_id, updated_by
  ) values (
    p_program_id, v_mission_id, p_assigned_by
  )
  on conflict (program_id) do nothing;

  insert into public.tbos_program_competencies (program_id, dimension_id, order_index)
  select p_program_id, dimension.id, dimension.order_index
  from public.tbos_behavioral_dimensions dimension
  where not exists (
    select 1 from public.tbos_program_competencies selected
    where selected.program_id = p_program_id
  )
  on conflict do nothing;

  insert into public.facilitator_program_assignments (
    profile_id, program_id, selected_mission_id, assigned_by, selected_at
  ) values (
    p_facilitator_id, p_program_id, v_mission_id, p_assigned_by, now()
  )
  on conflict (profile_id, program_id) do update
    set selected_mission_id = v_mission_id,
        selected_at = coalesce(public.facilitator_program_assignments.selected_at, now()),
        assigned_by = coalesce(public.facilitator_program_assignments.assigned_by, excluded.assigned_by),
        updated_at = now()
  returning * into v_assignment;

  insert into public.facilitator_missions (profile_id, program_id, mission_id)
  values (p_facilitator_id, p_program_id, v_mission_id)
  on conflict (profile_id, mission_id, program_id) do nothing;

  return v_assignment;
end;
$$;

create or replace function public.tbos_submit_program_observation(
  p_facilitator_id uuid,
  p_team_id uuid,
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
  v_team_batch text;
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
  if jsonb_typeof(p_scores) is distinct from 'array' or jsonb_typeof(p_members) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Skor dan anggota harus berupa array.';
  end if;

  select id into v_observation_id
  from public.tbos_observations
  where profile_id = p_facilitator_id and client_submission_id = btrim(p_client_submission_id);
  if found then return v_observation_id; end if;

  select engagement_id, batch into v_program_id, v_team_batch
  from public.tbos_teams where id = p_team_id for update;
  if not found or v_program_id is null then
    raise exception using errcode = '23503', message = 'Tim tidak ditemukan.';
  end if;
  if not exists (
    select 1 from public.program_modules
    where program_id = v_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;
  if not exists (
    select 1 from public.tbos_program_configurations configuration
    where configuration.program_id = v_program_id
      and configuration.observation_mission_id = p_mission_id
  ) then
    raise exception using errcode = '22023', message = 'Konteks observasi tidak sesuai dengan konfigurasi program.';
  end if;
  if not coalesce(p_is_admin, false) and not exists (
    select 1 from public.facilitator_program_assignments assignment
    where assignment.profile_id = p_facilitator_id and assignment.program_id = v_program_id
  ) then
    raise exception using errcode = '42501', message = 'Fasilitator belum ditugaskan pada program ini.';
  end if;
  if exists (
    select 1 from public.tbos_observations
    where program_id = v_program_id and team_id = p_team_id and mission_id = p_mission_id
  ) then
    raise exception using errcode = '23505', message = 'Tim ini sudah selesai dinilai.';
  end if;

  select count(*) into v_expected_count
  from public.tbos_program_competencies where program_id = v_program_id;
  begin
    select count(*) into v_score_count
    from jsonb_array_elements(p_scores) score
    join public.tbos_program_competencies competency
      on competency.program_id = v_program_id
      and competency.dimension_id = (score->>'dimensionId')::uuid
    join public.tbos_dimension_levels level
      on level.dimension_id = competency.dimension_id
      and level.level_value = (score->>'levelValue')::integer
    where jsonb_typeof(score) = 'object'
      and jsonb_typeof(score->'dimensionId') = 'string'
      and jsonb_typeof(score->'levelValue') = 'number';
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'Skor observasi tidak valid.';
  end;
  if v_expected_count not between 1 and 8
    or v_score_count <> v_expected_count
    or v_score_count <> jsonb_array_length(p_scores)
    or (select count(distinct score->>'dimensionId') from jsonb_array_elements(p_scores) score) <> v_score_count
  then
    raise exception using errcode = '22023', message = 'Setiap kompetensi program wajib dinilai tepat satu kali.';
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

  if exists (
    select 1
    from jsonb_array_elements(p_members) member
    left join public.tbos_team_members team_member
      on team_member.id = nullif(member->>'teamMemberId', '')::uuid
      and team_member.team_id = p_team_id
    where team_member.id is null
      or btrim(member->>'memberName') <> btrim(team_member.member_name)
      or (member->>'isCaptain')::boolean is distinct from team_member.is_captain
  ) then
    raise exception using errcode = '23503', message = 'Roster berisi anggota yang tidak terdaftar pada tim.';
  end if;

  insert into public.tbos_observations (
    team_id, program_id, mission_id, profile_id, batch, status, notes, client_submission_id
  ) values (
    p_team_id, v_program_id, p_mission_id, p_facilitator_id, v_team_batch,
    'submitted', nullif(btrim(coalesce(p_notes, '')), ''), btrim(p_client_submission_id)
  ) returning id into v_observation_id;

  insert into public.tbos_observation_scores (observation_id, dimension_id, level_value)
  select v_observation_id, (score->>'dimensionId')::uuid, (score->>'levelValue')::integer
  from jsonb_array_elements(p_scores) score;

  for v_member in select value from jsonb_array_elements(p_members)
  loop
    v_team_member_id := (v_member->>'teamMemberId')::uuid;
    select member_name, is_captain into v_source_member_name, v_source_is_captain
    from public.tbos_team_members
    where id = v_team_member_id and team_id = p_team_id;
    insert into public.tbos_observation_members (
      observation_id, team_member_id, member_name, is_present, is_captain
    ) values (
      v_observation_id, v_team_member_id, v_source_member_name,
      (v_member->>'isPresent')::boolean, v_source_is_captain
    );
  end loop;

  update public.tbos_program_configurations
  set competencies_locked_at = coalesce(competencies_locked_at, now()), updated_at = now()
  where program_id = v_program_id;
  update public.tbos_teams
  set roster_initialized_at = coalesce(roster_initialized_at, now()),
      roster_initialized_by = coalesce(roster_initialized_by, p_facilitator_id)
  where id = p_team_id;

  insert into public.tbos_observation_audit_log (
    observation_id, actor_id, actor_role, action, new_status, changes
  ) values (
    v_observation_id, p_facilitator_id,
    case when p_is_admin then 'admin' else 'facilitator' end,
    'create', 'submitted',
    jsonb_build_object('programId', v_program_id, 'competencyCount', v_score_count,
      'memberCount', v_member_count, 'presentCount', v_present_count)
  );

  return v_observation_id;
end;
$$;

revoke all on function public.tbos_submit_program_observation(uuid, uuid, uuid, text, text, jsonb, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.tbos_submit_program_observation(uuid, uuid, uuid, text, text, jsonb, jsonb, boolean)
  to service_role;

notify pgrst, 'reload schema';

commit;
