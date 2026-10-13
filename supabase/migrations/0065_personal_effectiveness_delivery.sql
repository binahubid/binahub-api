-- Phase 2: CEO-approved FREE-3 development pilot. SQL 64/private source required.
-- Never changes the immutable instrument or claims empirical validation.
begin;
do $$ begin
  if to_regclass('public.pe_instrument_versions') is null then raise exception 'PE_SQL64_REQUIRED'; end if;
  if not exists(select 1 from public.pe_instrument_versions where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1') then
    raise exception 'PE_PRIVATE_SOURCE_REQUIRED';
  end if;
end; $$;

create table if not exists public.pe_delivery_policies (
  id text primary key,
  instrument_id text not null,
  instrument_version text not null,
  free_codes text[] not null check(free_codes=array['PE-02','PE-04','PE-06']),
  release_status text not null check(release_status='development_pilot'),
  content_review text not null check(content_review='ceo_reviewed'),
  approval_reference text not null,
  consent_version text not null,
  privacy_version text not null,
  retention_months int not null check(retention_months=6),
  priority_version text not null,
  created_at timestamptz not null default now(),
  foreign key(instrument_id,instrument_version) references public.pe_instrument_versions
);
insert into public.pe_delivery_policies values(
  'pe-free3-2026-10-13-v1','BINAINSIGHTS-PE-V1','1.0.0-draft.1',array['PE-02','PE-04','PE-06'],
  'development_pilot','ceo_reviewed','User confirmation 2026-10-13: CEO author/domain expert approved recommendations and reviewed instrument',
  'pe-development-consent-v1','pe-personal-privacy-v1',6,'pe-relevance-evidence-v1',now()
) on conflict(id) do nothing;

alter table public.pe_catalog_crosswalks add column if not exists reviewer_name text;
-- Preserve an existing review. Approval can be attributable by name as well as account UUID.
do $$ declare v_constraint record; begin
  for v_constraint in select conname from pg_constraint where conrelid='public.pe_catalog_crosswalks'::regclass
    and contype='c' and pg_get_constraintdef(oid) like '%reviewed_by%' loop
    execute format('alter table public.pe_catalog_crosswalks drop constraint %I',v_constraint.conname);
  end loop;
end; $$;
alter table public.pe_catalog_crosswalks drop constraint if exists pe_crosswalk_review_required;
alter table public.pe_catalog_crosswalks add constraint pe_crosswalk_review_required check(
  status<>'approved' or ((reviewed_by is not null or nullif(btrim(reviewer_name),'') is not null)
    and reviewed_at is not null and nullif(btrim(review_reference),'') is not null));
update public.pe_catalog_crosswalks set status='approved',reviewer_name='CEO',reviewed_at=now(),
  review_reference='User confirmation 2026-10-13: CEO approved six proposed PE/catalog crosswalks'
where instrument_id='BINAINSIGHTS-PE-V1' and instrument_version='1.0.0-draft.1' and status='proposed';

create table if not exists public.pe_participant_attempts (
  id uuid primary key,
  owner_id uuid not null,
  policy_id text not null references public.pe_delivery_policies,
  status text not null default 'draft' check(status in ('draft','submitted')),
  revision int not null default 0 check(revision>=0),
  context jsonb not null,
  responses jsonb not null default '{}',
  response_timestamps jsonb not null default '{}',
  result jsonb,
  submission_key text,
  consented_at timestamptz not null default now(),
  retention_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  check(jsonb_typeof(context)='object' and jsonb_typeof(responses)='object'),
  check((status='draft' and result is null and submission_key is null and submitted_at is null)
    or(status='submitted' and result is not null and length(submission_key) between 16 and 128 and submitted_at is not null))
);
create index if not exists pe_participant_owner_idx on public.pe_participant_attempts(owner_id,created_at desc);
create index if not exists pe_participant_retention_idx on public.pe_participant_attempts(retention_until);
create table if not exists public.pe_participant_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.pe_participant_attempts(id) on delete set null,
  actor_id uuid,
  event text not null check(event in ('created','saved','submitted','erased','retention_expired')),
  revision int,
  created_at timestamptz not null default now()
);

create or replace function public.pe_participant_dto(a public.pe_participant_attempts) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
  select jsonb_build_object('id',a.id,'policyId',a.policy_id,'status',a.status,'revision',a.revision,
    'context',a.context,'responses',a.responses,'result',a.result,'createdAt',a.created_at,
    'updatedAt',a.updated_at,'submittedAt',a.submitted_at,'retentionUntil',a.retention_until);
$$;

create or replace function public.pe_start_participant(p_id uuid,p_owner uuid,p_context jsonb,p_consent_version text,p_privacy_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts; p public.pe_delivery_policies; v_inserted boolean;
begin
  if p_id is null or p_owner is null then raise exception 'PE_INVALID_REQUEST'; end if;
  select * into p from public.pe_delivery_policies where id='pe-free3-2026-10-13-v1';
  if not found then raise exception 'PE_DELIVERY_SETUP_REQUIRED'; end if;
  if p_consent_version is distinct from p.consent_version or p_privacy_version is distinct from p.privacy_version then
    raise exception 'PE_CONSENT_REQUIRED';
  end if;
  if p_context is null or jsonb_typeof(p_context)<>'object'
    or jsonb_typeof(p_context->'role') is distinct from 'string' or length(btrim(p_context->>'role')) not between 1 and 100
    or jsonb_typeof(p_context->'goal') is distinct from 'string' or length(btrim(p_context->>'goal')) not between 1 and 600
    or jsonb_typeof(p_context->'relevance') is distinct from 'object' then raise exception 'PE_INVALID_CONTEXT'; end if;
  if (select count(*) from jsonb_object_keys(p_context))<>3
    or (select count(*) from jsonb_object_keys(p_context->'relevance'))<>3
    or not(p_context->'relevance' ?& p.free_codes)
    or exists(select 1 from jsonb_each(p_context->'relevance') where value not in ('"low"'::jsonb,'"normal"'::jsonb,'"high"'::jsonb)) then
    raise exception 'PE_INVALID_CONTEXT';
  end if;
  insert into public.pe_participant_attempts(id,owner_id,policy_id,context,retention_until)
    values(p_id,p_owner,p.id,p_context,now()+make_interval(months=>p.retention_months))
    on conflict(id) do nothing returning * into a;
  v_inserted:=found;
  if not v_inserted then
    select * into a from public.pe_participant_attempts where id=p_id;
    if a.owner_id<>p_owner then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
    if a.context<>p_context or a.policy_id<>p.id then raise exception 'PE_START_CONFLICT'; end if;
    if a.retention_until<=now() then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  else
    insert into public.pe_participant_events(attempt_id,actor_id,event,revision) values(p_id,p_owner,'created',0);
  end if;
  return public.pe_participant_dto(a);
end; $$;

create or replace function public.pe_read_participant(p_id uuid,p_owner uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts;
begin
  select * into a from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now();
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  return public.pe_participant_dto(a);
end; $$;

create or replace function public.pe_write_participant(p_id uuid,p_owner uuid,p_revision int,p_responses jsonb,p_submit_key text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts; p public.pe_delivery_policies; m jsonb; r jsonb; rows jsonb;
  item jsonb; pair record; n int; times jsonb:='{}';
begin
  select * into a from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now() for update;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select * into strict p from public.pe_delivery_policies where id=a.policy_id;
  select manifest into strict m from public.pe_instrument_versions where instrument_id=p.instrument_id and version=p.instrument_version;
  if p_submit_key is not null and p_submit_key !~ '^[A-Za-z0-9_-]{16,128}$' then raise exception 'PE_INVALID_SUBMISSION_KEY'; end if;
  if a.status='submitted' then
    if p_submit_key is not null and a.submission_key=p_submit_key and a.responses=p_responses then return public.pe_participant_dto(a); end if;
    raise exception 'PE_ATTEMPT_FINALIZED';
  end if;
  if p_revision is null or a.revision<>p_revision then raise exception 'PE_REVISION_CONFLICT'; end if;
  r:=public.pe_score_responses(m,p_responses); -- strict validation, including NA vs missing
  for pair in select * from jsonb_each(p_responses) loop
    select value into item from jsonb_array_elements((m->'config'->'self_report_items')||(m->'config'->'sjt_items'))
      where value->>'id'=pair.key;
    if not(item->>'competency_code'=any(p.free_codes)) then raise exception 'PE_ENTITLEMENT_REQUIRED'; end if;
    times:=times||jsonb_build_object(pair.key,case when a.responses->pair.key=pair.value
      then a.response_timestamps->pair.key else to_jsonb(now()) end);
  end loop;
  if p_submit_key is not null then
    for item in select * from jsonb_array_elements((m->'config'->'self_report_items')||(m->'config'->'sjt_items'))
      where value->>'competency_code'=any(p.free_codes) loop
      if not(p_responses ? (item->>'id')) then raise exception 'PE_ANSWERS_INCOMPLETE'; end if;
    end loop;
  end if;
  select jsonb_agg(value order by value->>'code') into rows from jsonb_array_elements(r->'competencies')
    where value->>'code'=any(p.free_codes);
  select count(*) into n from jsonb_object_keys(p_responses);
  -- Only entitled methods/coverage leave the database. Hidden areas aren't represented as zero or missing.
  r:=jsonb_build_object('instrumentId',p.instrument_id,'instrumentVersion',p.instrument_version,
    'scoringVersion',m->'metadata'->>'scoring_version','policyId',p.id,'reportVersion','pe-web-development-v1',
    'releaseStatus',p.release_status,'contentReview',p.content_review,'priorityVersion',p.priority_version,
    'completeness',jsonb_build_object('expectedCount',18,'answeredCount',n,'naCount',(select count(*) from jsonb_each(p_responses) where value='"NA"'::jsonb)),
    'competencies',rows);
  update public.pe_participant_attempts set responses=p_responses,response_timestamps=times,revision=revision+1,updated_at=now(),
    status=case when p_submit_key is null then 'draft' else 'submitted' end,
    submission_key=p_submit_key,submitted_at=case when p_submit_key is not null then now() end,
    result=case when p_submit_key is not null then r end where id=p_id returning * into a;
  insert into public.pe_participant_events(attempt_id,actor_id,event,revision)
    values(p_id,p_owner,case when p_submit_key is null then 'saved' else 'submitted' end,a.revision);
  return public.pe_participant_dto(a);
end; $$;

create or replace function public.pe_erase_participant(p_id uuid,p_owner uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.pe_participant_attempts where id=p_id and owner_id=p_owner;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  insert into public.pe_participant_events(actor_id,event) values(p_owner,'erased');
  return true;
end; $$;

-- A scheduled worker can call this later; no cron/env or automatic job is installed here.
create or replace function public.pe_purge_expired_participants(p_limit int default 100) returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n int;
begin
  if p_limit not between 1 and 1000 then raise exception 'PE_INVALID_REQUEST'; end if;
  with removed as (delete from public.pe_participant_attempts where id in
    (select id from public.pe_participant_attempts where retention_until<=now() order by retention_until limit p_limit for update skip locked)
    returning id) select count(*) into n from removed;
  if n>0 then insert into public.pe_participant_events(event,revision) values('retention_expired',n); end if;
  return n;
end; $$;

alter table public.pe_delivery_policies enable row level security;
alter table public.pe_participant_attempts enable row level security;
alter table public.pe_participant_events enable row level security;
revoke all on public.pe_delivery_policies,public.pe_participant_attempts,public.pe_participant_events from public,anon,authenticated,service_role;
grant select on public.pe_delivery_policies,public.pe_participant_attempts,public.pe_participant_events to service_role;
revoke all on function public.pe_participant_dto(public.pe_participant_attempts),
  public.pe_start_participant(uuid,uuid,jsonb,text,text),public.pe_read_participant(uuid,uuid),
  public.pe_write_participant(uuid,uuid,int,jsonb,text),public.pe_erase_participant(uuid,uuid),
  public.pe_purge_expired_participants(int) from public,anon,authenticated,service_role;
grant execute on function public.pe_start_participant(uuid,uuid,jsonb,text,text),public.pe_read_participant(uuid,uuid),
  public.pe_write_participant(uuid,uuid,int,jsonb,text),public.pe_erase_participant(uuid,uuid),
  public.pe_purge_expired_participants(int) to service_role;
commit;
