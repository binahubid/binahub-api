-- T-BOS default operating model:
-- - every program selects one to eight competencies;
-- - the selection becomes immutable after the first observation;
-- - facilitators use one internal observation context instead of choosing a mission;
-- - Live Score can focus either the leaderboard or the countdown.

begin;

insert into public.tbos_missions (code, name, description)
values (
  'program_observation',
  'Observasi Kompetensi Program',
  'Konteks teknis untuk observasi kompetensi yang telah dipilih pada level program.'
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description;

insert into public.tbos_mission_dimensions (mission_id, dimension_id)
select mission.id, dimension.id
from public.tbos_missions mission
cross join public.tbos_behavioral_dimensions dimension
where mission.code = 'program_observation'
on conflict do nothing;

create table if not exists public.tbos_program_configurations (
  program_id uuid primary key references public.engagements(id) on delete cascade,
  observation_mission_id uuid not null references public.tbos_missions(id) on delete restrict,
  competencies_locked_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tbos_program_competencies (
  program_id uuid not null references public.tbos_program_configurations(program_id) on delete cascade,
  dimension_id uuid not null references public.tbos_behavioral_dimensions(id) on delete restrict,
  order_index integer not null,
  created_at timestamptz not null default now(),
  primary key (program_id, dimension_id),
  constraint tbos_program_competencies_order_positive check (order_index between 1 and 8),
  constraint tbos_program_competencies_order_unique unique (program_id, order_index)
);

comment on table public.tbos_program_configurations is
  'Program-level T-BOS configuration. Competencies lock automatically after the first observation.';
comment on table public.tbos_program_competencies is
  'The one to eight behavioral competencies measured by a T-BOS program.';

insert into public.tbos_program_configurations (
  program_id,
  observation_mission_id,
  competencies_locked_at
)
select
  module.program_id,
  mission.id,
  case when exists (
    select 1 from public.tbos_observations observation
    where observation.program_id = module.program_id
  ) then now() else null end
from public.program_modules module
cross join public.tbos_missions mission
where module.module_key = 'tbos'
  and module.enabled
  and mission.code = 'program_observation'
on conflict (program_id) do nothing;

insert into public.tbos_program_competencies (program_id, dimension_id, order_index)
select configuration.program_id, dimension.id, dimension.order_index
from public.tbos_program_configurations configuration
cross join public.tbos_behavioral_dimensions dimension
on conflict (program_id, dimension_id) do nothing;

alter table public.tbos_program_configurations enable row level security;
alter table public.tbos_program_competencies enable row level security;
revoke all on table public.tbos_program_configurations from public, anon, authenticated;
revoke all on table public.tbos_program_competencies from public, anon, authenticated;
grant all on table public.tbos_program_configurations to service_role;
grant all on table public.tbos_program_competencies to service_role;

create or replace function public.set_tbos_program_competencies(
  p_program_id uuid,
  p_dimension_ids uuid[],
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mission_id uuid;
  v_dimension_count integer;
begin
  if p_actor_id is null or not exists (
    select 1 from public.profiles where id = p_actor_id and role = 'admin'
  ) then
    raise exception using errcode = '42501', message = 'Hanya admin yang dapat mengatur kompetensi T-BOS.';
  end if;
  if not exists (
    select 1 from public.program_modules
    where program_id = p_program_id and module_key = 'tbos' and enabled
  ) then
    raise exception using errcode = '42501', message = 'Modul T-BOS tidak aktif untuk program ini.';
  end if;
  if p_dimension_ids is null or cardinality(p_dimension_ids) not between 1 and 8 then
    raise exception using errcode = '22023', message = 'Pilih minimal satu dan maksimal delapan kompetensi.';
  end if;
  select count(distinct requested.dimension_id)
    into v_dimension_count
  from unnest(p_dimension_ids) as requested(dimension_id)
  join public.tbos_behavioral_dimensions dimension on dimension.id = requested.dimension_id;
  if v_dimension_count <> cardinality(p_dimension_ids) then
    raise exception using errcode = '22023', message = 'Daftar kompetensi tidak valid atau berisi duplikasi.';
  end if;
  if exists (select 1 from public.tbos_observations where program_id = p_program_id) then
    raise exception using errcode = '42501', message = 'Kompetensi sudah terkunci karena observasi program telah dimulai.';
  end if;

  select id into v_mission_id
  from public.tbos_missions
  where code = 'program_observation';

  insert into public.tbos_program_configurations (
    program_id, observation_mission_id, updated_by, updated_at
  ) values (
    p_program_id, v_mission_id, p_actor_id, now()
  )
  on conflict (program_id) do update
  set observation_mission_id = excluded.observation_mission_id,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at;

  delete from public.tbos_program_competencies where program_id = p_program_id;
  insert into public.tbos_program_competencies (program_id, dimension_id, order_index)
  select p_program_id, requested.dimension_id, requested.ordinality::integer
  from unnest(p_dimension_ids) with ordinality requested(dimension_id, ordinality);
end;
$$;

revoke all on function public.set_tbos_program_competencies(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.set_tbos_program_competencies(uuid, uuid[], uuid)
  to service_role;

drop index if exists public.facilitator_program_one_facilitator_per_position;

alter table public.tbos_live_score_sessions
  add column if not exists display_focus text not null default 'leaderboard';
alter table public.tbos_live_score_sessions
  drop constraint if exists tbos_live_score_sessions_display_focus_check;
alter table public.tbos_live_score_sessions
  add constraint tbos_live_score_sessions_display_focus_check
  check (display_focus in ('leaderboard', 'countdown'));

alter table public.tbos_live_score_audit_log
  drop constraint if exists tbos_live_score_audit_log_action_check;
alter table public.tbos_live_score_audit_log
  add constraint tbos_live_score_audit_log_action_check
  check (action in (
    'configured', 'started', 'paused', 'reset', 'finished', 'elapsed',
    'scores_shown', 'scores_hidden', 'focus_leaderboard', 'focus_countdown'
  ));

notify pgrst, 'reload schema';

commit;
