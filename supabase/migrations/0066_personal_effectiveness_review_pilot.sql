-- Phases 3-4. Run after complete SQL 64/64B and SQL 65. No private CEO content.
-- Existing private results remain private until the owner explicitly grants review access.
begin;
do $$ begin
  if to_regclass('public.pe_participant_attempts') is null then raise exception 'PE_SQL65_REQUIRED'; end if;
  if not exists(select 1 from public.pe_delivery_policies where id='pe-free3-2026-10-13-v1') then
    raise exception 'PE_SQL65_REQUIRED';
  end if;
end; $$;

create table if not exists public.pe_pilot_settings (
  policy_id text primary key references public.pe_delivery_policies,
  status text not null default 'collecting' check(status in ('collecting','paused','completed')),
  revision int not null default 0 check(revision>=0),
  updated_at timestamptz not null default now()
);
insert into public.pe_pilot_settings(policy_id) values('pe-free3-2026-10-13-v1') on conflict do nothing;
create table if not exists public.pe_review_permissions (
  attempt_id uuid primary key references public.pe_participant_attempts on delete cascade,
  consent_version text check(consent_version='pe-consultant-review-v1'),
  granted_at timestamptz,
  revoked_at timestamptz,
  channel text not null default 'direct' check(channel in ('direct','instagram','tiktok','linkedin','google','email','website','other')),
  evaluation_consent boolean not null default false,
  updated_at timestamptz not null default now(),
  check(granted_at is null or consent_version is not null)
);
create table if not exists public.pe_pilot_feedback (
  attempt_id uuid primary key references public.pe_participant_attempts on delete cascade,
  clarity int not null check(clarity between 1 and 5),
  usefulness int not null check(usefulness between 1 and 5),
  updated_at timestamptz not null default now()
);
create table if not exists public.pe_pilot_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  status text not null check(status in ('collecting','paused','completed')),
  revision int not null,
  created_at timestamptz not null default now()
);

create or replace function public.pe_pilot_ready() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.pe_pilot_settings s
    join public.pe_delivery_policies p on p.id=s.policy_id
    join public.pe_instrument_versions v on v.instrument_id=p.instrument_id and v.version=p.instrument_version
    where p.id='pe-free3-2026-10-13-v1' and s.status='collecting'
      and p.content_review='ceo_reviewed' and p.release_status='development_pilot'
      and p.free_codes=array['PE-02','PE-04','PE-06'] and p.retention_months=6
      and jsonb_array_length(v.manifest->'config'->'competencies')=6
      and jsonb_array_length(v.manifest->'config'->'self_report_items')=24
      and jsonb_array_length(v.manifest->'config'->'sjt_items')=12
      and (select count(*) from public.pe_catalog_crosswalks c where c.instrument_id=p.instrument_id
        and c.instrument_version=p.instrument_version and c.status='approved')=6);
$$;

create or replace function public.pe_start_participant_v2(p_id uuid,p_owner uuid,p_context jsonb,
  p_consent_version text,p_privacy_version text,p_sharing_version text default null,p_channel text default 'direct')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  -- Serialize starts against the one operational pause switch. Existing attempts can resume.
  perform 1 from public.pe_pilot_settings where policy_id='pe-free3-2026-10-13-v1' for share;
  if not found then raise exception 'PE_PILOT_SETUP_REQUIRED'; end if;
  if not exists(select 1 from public.pe_participant_attempts where id=p_id and owner_id=p_owner)
    and not public.pe_pilot_ready() then raise exception 'PE_PILOT_PAUSED'; end if;
  if p_sharing_version is not null and p_sharing_version<>'pe-consultant-review-v1' then raise exception 'PE_CONSENT_REQUIRED'; end if;
  if p_channel is null or p_channel not in ('direct','instagram','tiktok','linkedin','google','email','website','other') then
    raise exception 'PE_INVALID_REQUEST';
  end if;
  result:=public.pe_start_participant(p_id,p_owner,p_context,p_consent_version,p_privacy_version);
  insert into public.pe_review_permissions(attempt_id,consent_version,granted_at,channel)
    values(p_id,p_sharing_version,case when p_sharing_version is not null then now() end,p_channel)
    on conflict(attempt_id) do nothing; -- A retry must never regrant revoked permission.
  return result;
end; $$;

-- Keep the pause effective even if a later administrative SQL 64/65 replay regrants legacy RPCs.
create or replace function public.pe_guard_new_pilot_attempt() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.pe_participant_attempts where id=new.id) then return new; end if;
  perform 1 from public.pe_pilot_settings where policy_id=new.policy_id for share;
  if not public.pe_pilot_ready() then raise exception 'PE_PILOT_PAUSED'; end if;
  return new;
end; $$;
drop trigger if exists pe_new_attempt_pilot_guard on public.pe_participant_attempts;
create trigger pe_new_attempt_pilot_guard before insert on public.pe_participant_attempts
  for each row execute function public.pe_guard_new_pilot_attempt();

create or replace function public.pe_owner_review_access(p_id uuid,p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now()) then
    raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select jsonb_build_object('shared',r.granted_at is not null and r.revoked_at is null,
    'evaluationConsent',r.evaluation_consent,'clarity',f.clarity,'usefulness',f.usefulness) into result
    from public.pe_review_permissions r left join public.pe_pilot_feedback f on f.attempt_id=r.attempt_id where r.attempt_id=p_id;
  return coalesce(result,jsonb_build_object('shared',false,'evaluationConsent',false,'clarity',null,'usefulness',null));
end; $$;

create or replace function public.pe_update_review_access(p_id uuid,p_owner uuid,p_share boolean,
  p_consent_version text,p_evaluate boolean,p_clarity int default null,p_usefulness int default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts;
begin
  select * into a from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now() for update;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  if p_share is null or p_evaluate is null or (p_share and p_consent_version is distinct from 'pe-consultant-review-v1') then
    raise exception 'PE_CONSENT_REQUIRED'; end if;
  if (p_clarity is null)<>(p_usefulness is null)
    or (p_clarity is not null and (p_clarity not between 1 and 5 or p_usefulness not between 1 and 5
      or not p_evaluate or a.status<>'submitted')) then raise exception 'PE_INVALID_REQUEST'; end if;
  insert into public.pe_review_permissions(attempt_id,consent_version,granted_at,revoked_at,evaluation_consent)
    values(p_id,case when p_share then p_consent_version end,case when p_share then now() end,
      case when not p_share then now() end,p_evaluate)
    on conflict(attempt_id) do update set
      consent_version=case when p_share then p_consent_version else pe_review_permissions.consent_version end,
      granted_at=case when p_share then coalesce(pe_review_permissions.granted_at,now()) else pe_review_permissions.granted_at end,
      revoked_at=case when not p_share then now() end,evaluation_consent=p_evaluate,updated_at=now();
  if not p_evaluate then delete from public.pe_pilot_feedback where attempt_id=p_id;
  elsif p_clarity is not null then
    insert into public.pe_pilot_feedback(attempt_id,clarity,usefulness) values(p_id,p_clarity,p_usefulness)
      on conflict(attempt_id) do update set clarity=p_clarity,usefulness=p_usefulness,updated_at=now();
  end if;
  return public.pe_owner_review_access(p_id,p_owner);
end; $$;

create or replace function public.pe_owner_history(p_owner uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'createdAt',created_at,
    'retentionUntil',retention_until,'answeredCount',jsonb_object_length_safe) order by created_at desc,id desc),'[]')
  from (select a.id,a.status,a.created_at,a.retention_until,
    (select count(*) from jsonb_object_keys(a.responses)) as jsonb_object_length_safe
    from public.pe_participant_attempts a where owner_id=p_owner and retention_until>now()
    order by created_at desc,id desc limit 10) rows;
$$;

create or replace function public.pe_admin_review_cases(p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'createdAt',created_at,
    'role',context->>'role','goal',context->>'goal','channel',channel) order by created_at desc,id desc),'[]')
  from (select a.id,a.status,a.created_at,a.context,r.channel from public.pe_participant_attempts a
    join public.pe_review_permissions r on r.attempt_id=a.id
    where r.granted_at is not null and r.revoked_at is null and a.retention_until>now()
      and (p_before is null or (p_before_id is not null and (a.created_at,a.id)<(p_before,p_before_id)))
    order by a.created_at desc,a.id desc limit 20) rows;
$$;

create or replace function public.pe_admin_review_case(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts;
begin
  select t.* into a from public.pe_participant_attempts t
    join public.pe_review_permissions r on r.attempt_id=t.id
    where t.id=p_id and t.retention_until>now() and r.granted_at is not null and r.revoked_at is null;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  return jsonb_build_object('attempt',public.pe_participant_dto(a),'ownerId',a.owner_id,
    'channel',(select channel from public.pe_review_permissions where attempt_id=p_id));
end; $$;

create or replace function public.pe_pilot_dashboard() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.pe_pilot_settings; counts jsonb; sample_size int; rows jsonb; feedback jsonb;
begin
  select * into s from public.pe_pilot_settings where policy_id='pe-free3-2026-10-13-v1';
  if not found then raise exception 'PE_PILOT_SETUP_REQUIRED'; end if;
  select jsonb_build_object('started',count(*),'submitted',count(*) filter(where a.status='submitted'),
    'drafts',count(*) filter(where a.status='draft'),'shared',count(*) filter(where r.granted_at is not null and r.revoked_at is null))
    into counts from public.pe_participant_attempts a left join public.pe_review_permissions r on r.attempt_id=a.id
    where a.retention_until>now();
  -- One latest completed attempt per consenting participant; no arbitrary date/source filters.
  with eligible as (select distinct on(a.owner_id) a.owner_id,a.result,a.created_at,a.submitted_at
    from public.pe_participant_attempts a join public.pe_review_permissions r on r.attempt_id=a.id
    where a.status='submitted' and a.retention_until>now() and r.evaluation_consent
    order by a.owner_id,a.submitted_at desc,a.id desc)
  select count(*)::int into sample_size from eligible;
  if sample_size>=5 then
    with eligible as (select distinct on(a.owner_id) a.result from public.pe_participant_attempts a
      join public.pe_review_permissions r on r.attempt_id=a.id where a.status='submitted'
      and a.retention_until>now() and r.evaluation_consent order by a.owner_id,a.submitted_at desc,a.id desc),
    areas as (select jsonb_array_elements(result->'competencies') value from eligible)
    select jsonb_agg(row order by row->>'code') into rows from (
      select jsonb_build_object('code',value->>'code',
        'selfReportMean',case when count(value->'selfReport'->>'score')>=5 then round(avg((value->'selfReport'->>'score')::numeric),2) end,
        'sjtMean',case when count(value->'sjt'->>'score')>=5 then round(avg((value->'sjt'->>'score')::numeric),2) end,
        'selfReportAvailable',count(value->'selfReport'->>'score'),
        'meanNACount',round(avg((value->'selfReport'->>'naCount')::numeric),2)) row from areas group by value->>'code'
    ) aggregate_rows;
  end if;
  with latest as (select distinct on(a.owner_id) f.clarity,f.usefulness from public.pe_participant_attempts a
    join public.pe_review_permissions r on r.attempt_id=a.id join public.pe_pilot_feedback f on f.attempt_id=a.id
    where a.retention_until>now() and r.evaluation_consent order by a.owner_id,f.updated_at desc,a.id desc)
  select jsonb_build_object('count',count(*),'clarityMean',case when count(*)>=5 then round(avg(clarity),2) end,
    'usefulnessMean',case when count(*)>=5 then round(avg(usefulness),2) end) into feedback from latest;
  return jsonb_build_object('status',s.status,'revision',s.revision,'ready',public.pe_pilot_ready(),
    'counts',counts,'evaluationSampleSize',sample_size,'minimumAggregateSize',5,'areas',coalesce(rows,'[]'),
    'feedback',feedback,'interpretation','development_pilot_not_validated');
end; $$;

create or replace function public.pe_set_pilot_state(p_status text,p_revision int,p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.pe_pilot_settings;
begin
  if p_actor is null or p_status is null or p_status not in ('collecting','paused','completed') then raise exception 'PE_INVALID_REQUEST'; end if;
  select * into s from public.pe_pilot_settings where policy_id='pe-free3-2026-10-13-v1' for update;
  if not found then raise exception 'PE_PILOT_SETUP_REQUIRED'; end if;
  if p_revision is null or p_revision<>s.revision then raise exception 'PE_REVISION_CONFLICT'; end if;
  if p_status<>s.status then
    update public.pe_pilot_settings set status=p_status,revision=revision+1,updated_at=now() where policy_id=s.policy_id;
    if p_status='collecting' and not public.pe_pilot_ready() then raise exception 'PE_DELIVERY_SETUP_REQUIRED'; end if;
    insert into public.pe_pilot_events(actor_id,status,revision) values(p_actor,p_status,s.revision+1);
  end if;
  return public.pe_pilot_dashboard();
end; $$;

alter table public.pe_pilot_settings enable row level security;
alter table public.pe_review_permissions enable row level security;
alter table public.pe_pilot_feedback enable row level security;
alter table public.pe_pilot_events enable row level security;
revoke all on public.pe_pilot_settings,public.pe_review_permissions,public.pe_pilot_feedback,public.pe_pilot_events
  from public,anon,authenticated,service_role;
revoke all on function public.pe_guard_new_pilot_attempt(),public.pe_pilot_ready(),public.pe_start_participant_v2(uuid,uuid,jsonb,text,text,text,text),
  public.pe_owner_review_access(uuid,uuid),public.pe_update_review_access(uuid,uuid,boolean,text,boolean,int,int),
  public.pe_owner_history(uuid),public.pe_admin_review_cases(timestamptz,uuid),public.pe_admin_review_case(uuid),
  public.pe_pilot_dashboard(),public.pe_set_pilot_state(text,int,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pe_pilot_ready(),public.pe_start_participant_v2(uuid,uuid,jsonb,text,text,text,text),
  public.pe_owner_review_access(uuid,uuid),public.pe_update_review_access(uuid,uuid,boolean,text,boolean,int,int),
  public.pe_owner_history(uuid),public.pe_admin_review_cases(timestamptz,uuid),public.pe_admin_review_case(uuid),
  public.pe_pilot_dashboard(),public.pe_set_pilot_state(text,int,uuid) to service_role;
-- No older server can bypass the new-start pause switch via the legacy entry point.
revoke execute on function public.pe_start_participant(uuid,uuid,jsonb,text,text) from service_role;
commit;
