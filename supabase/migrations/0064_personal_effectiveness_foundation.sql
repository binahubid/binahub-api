-- Phase 1 only: private, versioned PE instrument and INTERNAL TEST attempts.
-- No public launch, lead creation, email, catalog activation, paid/free entitlement or AI.
-- Run after SQL 63. Applying this migration does not start a pilot with participants.
begin;

do $$ begin
  if to_regclass('public.competency_dictionary') is null then
    raise exception 'PE_CATALOG_PREREQUISITE: run SQL 63 first';
  end if;
end; $$;

create table if not exists public.pe_instrument_versions (
  instrument_id text not null,
  version text not null,
  bundle_sha256 text not null check (bundle_sha256 ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  release_status text not null default 'draft' check (release_status = 'draft'),
  public_enabled boolean not null default false check (not public_enabled),
  created_at timestamptz not null default now(),
  primary key (instrument_id, version)
);

create table if not exists public.pe_catalog_crosswalks (
  instrument_id text not null,
  instrument_version text not null,
  pe_code text not null check (pe_code ~ '^PE-[0-9]{2}$'),
  framework_id text not null,
  catalog_code text not null,
  status text not null default 'proposed' check (status in ('proposed','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reference text,
  primary key (instrument_id, instrument_version, pe_code),
  foreign key (instrument_id, instrument_version) references public.pe_instrument_versions,
  foreign key (framework_id, catalog_code) references public.competency_dictionary(framework_id, code),
  check (status <> 'approved' or (reviewed_by is not null and reviewed_at is not null and nullif(btrim(review_reference),'') is not null))
);

create table if not exists public.pe_attempts (
  id uuid primary key,
  participant_ref uuid not null,
  created_by uuid not null,
  mode text not null default 'internal_test' check (mode = 'internal_test'),
  instrument_id text not null,
  instrument_version text not null,
  consent_notice_version text not null check (length(btrim(consent_notice_version)) between 1 and 120),
  privacy_policy_version text not null check (length(btrim(privacy_policy_version)) between 1 and 120),
  consented_at timestamptz not null,
  retention_until timestamptz not null,
  status text not null default 'draft' check (status in ('draft','submitted')),
  revision integer not null default 0 check (revision >= 0),
  responses jsonb not null default '{}'::jsonb check (jsonb_typeof(responses) = 'object'),
  response_timestamps jsonb not null default '{}'::jsonb check (jsonb_typeof(response_timestamps) = 'object'),
  submission_key text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  foreign key (instrument_id, instrument_version) references public.pe_instrument_versions,
  check ((status = 'draft' and submission_key is null and result is null and submitted_at is null)
    or (status = 'submitted' and length(submission_key) between 16 and 128 and result is not null and submitted_at is not null))
);
create index if not exists pe_attempts_participant_idx on public.pe_attempts(participant_ref, created_at desc);
create index if not exists pe_attempts_retention_idx on public.pe_attempts(retention_until);

create table if not exists public.pe_audit_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.pe_attempts(id) on delete set null,
  actor_ref uuid not null,
  event text not null check (event in ('internal_attempt_created','draft_saved','submitted','internal_attempt_deleted')),
  revision integer,
  created_at timestamptz not null default now()
  -- Deliberately no answers, score details, names, emails, or third-party telemetry.
);

create or replace function public.pe_reject_instrument_mutation() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception 'PE_VERSION_IMMUTABLE: insert a new instrument version';
end;
$$;
drop trigger if exists pe_immutable_version on public.pe_instrument_versions;
create trigger pe_immutable_version before update or delete on public.pe_instrument_versions
for each row execute function public.pe_reject_instrument_mutation();

-- Authoritative scorer. Receives only a pinned immutable manifest and raw answers.
-- Also used by the write RPC; callers cannot supply computed scores.
create or replace function public.pe_score_responses(p_manifest jsonb, p_responses jsonb) returns jsonb
language plpgsql immutable set search_path = pg_catalog, public as $$
declare
  v_item jsonb; v_answer jsonb; v_pair record; v_comp jsonb;
  v_rows jsonb := '[]'; v_sr_count int; v_na int; v_sr_sum numeric;
  v_sjt_count int; v_sjt_sum numeric; v_answered int; v_scored int := 0;
  v_sr_ready boolean; v_sjt_ready boolean;
begin
  if p_manifest is null or p_responses is null or jsonb_typeof(p_responses) <> 'object' then
    raise exception 'PE_INVALID_RESPONSES';
  end if;
  if p_manifest->'config'->'assessment'->>'id' is distinct from 'BINAINSIGHTS-PE-V1'
    or p_manifest->'metadata'->>'scoring_version' is distinct from 'pe-dual-method-v1' then
    raise exception 'PE_UNSUPPORTED_SCORING_VERSION';
  end if;
  for v_pair in select * from jsonb_each(p_responses) loop
    select item into v_item from jsonb_array_elements(p_manifest->'config'->'self_report_items') item
      where item->>'id' = v_pair.key;
    if v_item is not null then
      if v_pair.value <> '"NA"'::jsonb and not (
        jsonb_typeof(v_pair.value) = 'number' and v_pair.value in ('1','2','3','4','5')
      ) then raise exception 'PE_INVALID_RESPONSE'; end if;
    else
      select item into v_item from jsonb_array_elements(p_manifest->'config'->'sjt_items') item
        where item->>'id' = v_pair.key;
      if v_item is null or jsonb_typeof(v_pair.value) <> 'string'
        or not (v_item->'option_scores' ? (v_pair.value #>> '{}')) then
        raise exception 'PE_INVALID_RESPONSE';
      end if;
    end if;
  end loop;
  select count(*) into v_answered from jsonb_object_keys(p_responses);
  for v_comp in select * from jsonb_array_elements(p_manifest->'config'->'competencies') loop
    v_sr_count := 0; v_na := 0; v_sr_sum := 0; v_sjt_count := 0; v_sjt_sum := 0;
    for v_item in select * from jsonb_array_elements(p_manifest->'config'->'self_report_items') item
      where item->>'competency_code' = v_comp->>'code' loop
      v_answer := p_responses->(v_item->>'id');
      if v_answer = '"NA"'::jsonb then v_na := v_na + 1;
      elsif v_answer is not null then
        v_sr_count := v_sr_count + 1; v_sr_sum := v_sr_sum + (v_answer #>> '{}')::numeric;
      end if;
    end loop;
    for v_item in select * from jsonb_array_elements(p_manifest->'config'->'sjt_items') item
      where item->>'competency_code' = v_comp->>'code' loop
      v_answer := p_responses->(v_item->>'id');
      if v_answer is not null then
        v_sjt_count := v_sjt_count + 1;
        v_sjt_sum := v_sjt_sum + (v_item->'option_scores'->>(v_answer #>> '{}'))::numeric;
      end if;
    end loop;
    v_sr_ready := v_sr_count >= (p_manifest->'config'->'scoring'->'self_report'->>'minimum_valid_items_per_competency')::int;
    v_sjt_ready := v_sjt_count >= (p_manifest->'config'->'scoring'->'sjt'->>'minimum_valid_scenarios_per_competency')::int;
    v_scored := v_scored + v_sr_ready::int + v_sjt_ready::int;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('code',v_comp->>'code',
      'selfReport', jsonb_build_object('status',case when v_sr_ready then 'scored' else 'insufficient_evidence' end,
        'validCount',v_sr_count,'naCount',v_na,'missingCount',4-v_sr_count-v_na,'expectedCount',4,'rawSum',v_sr_sum,
        'mean',case when v_sr_ready then round(v_sr_sum/v_sr_count,2) end,
        'score',case when v_sr_ready then round(((v_sr_sum/v_sr_count-1)/4)*100,2) end),
      'sjt', jsonb_build_object('status',case when v_sjt_ready then 'scored' else 'incomplete' end,
        'validCount',v_sjt_count,'missingCount',2-v_sjt_count,'expectedCount',2,'rawSum',v_sjt_sum,
        'maximum',3*v_sjt_count,'score',case when v_sjt_ready then round(v_sjt_sum/(3*v_sjt_count)*100,2) end)));
  end loop;
  return jsonb_build_object('instrumentId',p_manifest->'config'->'assessment'->>'id',
    'instrumentVersion',p_manifest->'metadata'->>'instrument_version',
    'scoringVersion',p_manifest->'metadata'->>'scoring_version',
    'reportRulesVersion',p_manifest->'metadata'->>'report_rules_version',
    'priorityRulesVersion',p_manifest->'metadata'->>'priority_rules_version',
    'validationStatus',p_manifest->'config'->'assessment'->>'status',
    'completeness',jsonb_build_object('expectedCount',36,'answeredCount',v_answered,'missingCount',36-v_answered,
      'naCount',(select count(*) from jsonb_each(p_responses) where value='"NA"'::jsonb),'scoredMethods',v_scored),
    'competencies',v_rows);
end;
$$;

create or replace function public.pe_attempt_dto(p_attempt public.pe_attempts) returns jsonb
language sql immutable set search_path = pg_catalog, public as $$
  select jsonb_build_object('id',p_attempt.id,'instrumentId',p_attempt.instrument_id,
    'instrumentVersion',p_attempt.instrument_version,'mode',p_attempt.mode,'status',p_attempt.status,
    'revision',p_attempt.revision,'responses',p_attempt.responses,'responseTimestamps',p_attempt.response_timestamps,
    'result',p_attempt.result,'createdAt',p_attempt.created_at,'updatedAt',p_attempt.updated_at,
    'submittedAt',p_attempt.submitted_at,'retentionUntil',p_attempt.retention_until);
$$;

create or replace function public.pe_start_internal_attempt(
  p_id uuid, p_participant_ref uuid, p_actor_ref uuid,
  p_consent_notice_version text, p_privacy_policy_version text,
  p_consented_at timestamptz, p_retention_until timestamptz
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_attempt public.pe_attempts; v_inserted boolean;
begin
  if not exists(select 1 from public.pe_instrument_versions where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1') then
    raise exception 'PE_INSTRUMENT_SETUP_REQUIRED';
  end if;
  if p_id is null or p_participant_ref is null or p_actor_ref is null
    or p_consented_at is null or p_consented_at > now() or p_consented_at < now()-interval '30 days'
    or p_retention_until is null or p_retention_until <= now() or p_retention_until > now()+interval '30 days'
    or nullif(btrim(p_consent_notice_version),'') is null or nullif(btrim(p_privacy_policy_version),'') is null then
    raise exception 'PE_INTERNAL_TEST_METADATA_REQUIRED';
  end if;
  insert into public.pe_attempts(id,participant_ref,created_by,instrument_id,instrument_version,
    consent_notice_version,privacy_policy_version,consented_at,retention_until)
  values(p_id,p_participant_ref,p_actor_ref,'BINAINSIGHTS-PE-V1','1.0.0-draft.1',
    p_consent_notice_version,p_privacy_policy_version,p_consented_at,p_retention_until)
  on conflict(id) do nothing returning * into v_attempt;
  v_inserted := found;
  if not v_inserted then
    select * into v_attempt from public.pe_attempts where id=p_id;
    if v_attempt.participant_ref <> p_participant_ref or v_attempt.created_by <> p_actor_ref
      or v_attempt.consent_notice_version <> p_consent_notice_version
      or v_attempt.privacy_policy_version <> p_privacy_policy_version
      or v_attempt.consented_at <> p_consented_at or v_attempt.retention_until <> p_retention_until then
      raise exception 'PE_START_CONFLICT';
    end if;
  else
    insert into public.pe_audit_events(attempt_id,actor_ref,event,revision)
      values(p_id,p_actor_ref,'internal_attempt_created',0);
  end if;
  return public.pe_attempt_dto(v_attempt);
end;
$$;

create or replace function public.pe_get_internal_attempt(p_id uuid,p_participant_ref uuid,p_actor_ref uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_attempt public.pe_attempts;
begin
  select * into v_attempt from public.pe_attempts where id=p_id
    and participant_ref=p_participant_ref and created_by=p_actor_ref and retention_until>now();
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  return public.pe_attempt_dto(v_attempt);
end;
$$;

-- A full answer snapshot replaces the draft. Removing an ID means unanswered, never NA.
-- Row lock + revision prevent lost updates; the submit key and snapshot are checked on replay.
create or replace function public.pe_write_internal_attempt(
  p_id uuid,p_participant_ref uuid,p_actor_ref uuid,p_expected_revision int,p_responses jsonb,p_submission_key text default null
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_attempt public.pe_attempts; v_manifest jsonb; v_result jsonb; v_times jsonb := '{}'; v_pair record;
begin
  select * into v_attempt from public.pe_attempts where id=p_id and participant_ref=p_participant_ref
    and created_by=p_actor_ref and retention_until>now() for update;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  if p_submission_key is not null and (length(p_submission_key) not between 16 and 128 or p_submission_key !~ '^[A-Za-z0-9_-]+$') then
    raise exception 'PE_INVALID_SUBMISSION_KEY';
  end if;
  if v_attempt.status='submitted' then
    if p_submission_key is not null and v_attempt.submission_key=p_submission_key and v_attempt.responses=p_responses then
      return public.pe_attempt_dto(v_attempt);
    end if;
    raise exception 'PE_ATTEMPT_FINALIZED';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_attempt.revision then raise exception 'PE_REVISION_CONFLICT'; end if;
  select manifest into strict v_manifest from public.pe_instrument_versions
    where instrument_id=v_attempt.instrument_id and version=v_attempt.instrument_version;
  v_result := public.pe_score_responses(v_manifest,p_responses); -- Validate before ANY mutation.
  for v_pair in select * from jsonb_each(p_responses) loop
    v_times := v_times || jsonb_build_object(v_pair.key,case
      when v_attempt.responses->v_pair.key = v_pair.value then v_attempt.response_timestamps->v_pair.key
      else to_jsonb(now()) end);
  end loop;
  update public.pe_attempts set responses=p_responses,response_timestamps=v_times,revision=revision+1,updated_at=now(),
    status=case when p_submission_key is null then 'draft' else 'submitted' end,
    submission_key=p_submission_key,result=case when p_submission_key is not null then v_result end,
    submitted_at=case when p_submission_key is not null then now() end
  where id=p_id returning * into v_attempt;
  insert into public.pe_audit_events(attempt_id,actor_ref,event,revision)
    values(p_id,p_actor_ref,case when p_submission_key is null then 'draft_saved' else 'submitted' end,v_attempt.revision);
  return public.pe_attempt_dto(v_attempt);
end;
$$;

-- Explicit erasure only. No cleanup job or production retention policy is activated.
create or replace function public.pe_delete_internal_attempt(p_id uuid,p_participant_ref uuid,p_actor_ref uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  delete from public.pe_attempts where id=p_id and participant_ref=p_participant_ref and created_by=p_actor_ref;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  insert into public.pe_audit_events(actor_ref,event) values(p_actor_ref,'internal_attempt_deleted');
  return true;
end;
$$;

-- Source registration is database-admin only. The actual source belongs outside Git.
create or replace function public.pe_register_draft_instrument_v1(p_manifest jsonb,p_bundle_sha256 text)
returns boolean language plpgsql set search_path = pg_catalog, public as $$
declare v_config jsonb; v_meta jsonb; v_comp jsonb; v_item jsonb; v_link jsonb; v_option jsonb;
  v_existing public.pe_instrument_versions; v_code text; v_id text; v_version text; v_map jsonb;
begin
  v_config:=p_manifest->'config'; v_meta:=p_manifest->'metadata';
  v_id:=v_config->'assessment'->>'id'; v_version:=v_meta->>'instrument_version';
  if p_manifest is null or p_bundle_sha256 is null or p_bundle_sha256 !~ '^[a-f0-9]{64}$'
    or v_id is distinct from 'BINAINSIGHTS-PE-V1' or nullif(v_version,'') is null
    or v_meta->>'scoring_version' is distinct from 'pe-dual-method-v1'
    or v_meta->>'release_status' is distinct from 'draft' or v_meta->'public_enabled' is distinct from 'false'::jsonb
    or v_meta->>'priority_rules_version' is distinct from 'awaiting_ceo'
    or nullif(v_meta->>'report_rules_version','') is null or nullif(v_meta->>'item_version','') is null
    or v_config->'assessment'->>'status' is distinct from 'DRAFT_FOR_EXPERT_REVIEW_AND_PILOT'
    or v_config->'scoring'->'self_report'->'minimum_valid_items_per_competency' is distinct from '3'::jsonb
    or v_config->'scoring'->'sjt'->'minimum_valid_scenarios_per_competency' is distinct from '2'::jsonb then
    raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
  end if;
  if jsonb_typeof(v_config->'competencies') is distinct from 'array'
    or jsonb_typeof(v_config->'self_report_items') is distinct from 'array'
    or jsonb_typeof(v_config->'sjt_items') is distinct from 'array'
    or jsonb_typeof(p_manifest->'key_actions') is distinct from 'array'
    or jsonb_typeof(p_manifest->'catalog_crosswalks') is distinct from 'array'
    or jsonb_typeof(v_meta->'sources') is distinct from 'array' then raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID'; end if;
  if jsonb_array_length(v_config->'competencies')<>6 or jsonb_array_length(v_config->'self_report_items')<>24
    or jsonb_array_length(v_config->'sjt_items')<>12 or jsonb_array_length(p_manifest->'key_actions')<>25
    or jsonb_array_length(p_manifest->'catalog_crosswalks')<>6 or jsonb_array_length(v_meta->'sources')<>3 then
    raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
  end if;
  if (select count(distinct value->>'code') from jsonb_array_elements(v_config->'competencies'))<>6
    or (select count(distinct value->>'code') from jsonb_array_elements(p_manifest->'key_actions'))<>25
    or (select count(distinct value->>'pe_code') from jsonb_array_elements(p_manifest->'catalog_crosswalks'))<>6 then
    raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
  end if;
  for v_link in select * from jsonb_array_elements(v_meta->'sources') loop
    if coalesce(v_link->>'sha256','') !~ '^[a-f0-9]{64}$' or nullif(v_link->>'file','') is null then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
  end loop;
  for v_comp in select * from jsonb_array_elements(v_config->'competencies') loop
    v_code:=v_comp->>'code';
    if coalesce(v_code,'') !~ '^PE-0[1-6]$' or nullif(v_comp->>'name','') is null or nullif(v_comp->>'definition','') is null
      or (select count(*) from jsonb_array_elements(v_config->'self_report_items') where value->>'competency_code'=v_code)<>4
      or (select count(*) from jsonb_array_elements(v_config->'sjt_items') where value->>'competency_code'=v_code)<>2
      or (select count(*) from jsonb_array_elements(p_manifest->'key_actions') where value->>'competency_code'=v_code)<>(case when v_code='PE-01' then 5 else 4 end) then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
  end loop;
  for v_link in select * from jsonb_array_elements(p_manifest->'key_actions') loop
    if coalesce(v_link->>'code','') !~ '^KA0[1-6]\.[1-5]$' or nullif(v_link->>'text','') is null
      or substring(v_link->>'code' from 3 for 2) is distinct from right(v_link->>'competency_code',2) then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(v_config->'self_report_items'))<>24
    or (select count(distinct value->>'id') from jsonb_array_elements(v_config->'sjt_items'))<>12 then
    raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
  end if;
  for v_item in select * from jsonb_array_elements(v_config->'self_report_items') loop
    if coalesce(v_item->>'id','') !~ '^SR(0[1-9]|1[0-9]|2[0-4])$' or nullif(v_item->>'prompt','') is null
      or v_item->>'type' is distinct from 'behavioral_self_report' or v_item->'lookback_period_months' is distinct from '3'::jsonb
      or not exists(select 1 from jsonb_array_elements(p_manifest->'key_actions') where value->>'code'=v_item->>'key_action_code' and value->>'competency_code'=v_item->>'competency_code') then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(v_config->'sjt_items') loop
    if coalesce(v_item->>'id','') !~ '^SJ(0[1-9]|1[0-2])$' or nullif(v_item->>'scenario','') is null
      or nullif(v_item->>'question','') is null or v_item->>'type' is distinct from 'situational_judgment'
      or v_item->>'key_status' is distinct from 'PROVISIONAL' or coalesce(v_item->>'scoring_key','') not in ('A','B','C','D')
      or jsonb_typeof(v_item->'options') is distinct from 'array' or jsonb_typeof(v_item->'key_action_codes') is distinct from 'array'
      or jsonb_typeof(v_item->'option_scores') is distinct from 'object' or jsonb_typeof(v_item->'rationales') is distinct from 'object' then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
    if jsonb_array_length(v_item->'options')<>4 or jsonb_array_length(v_item->'key_action_codes')<1
      or (select count(distinct value) from jsonb_array_elements_text(v_item->'key_action_codes'))<>jsonb_array_length(v_item->'key_action_codes')
      or (select count(distinct value->>'id') from jsonb_array_elements(v_item->'options'))<>4
      or (select count(*) from jsonb_object_keys(v_item->'option_scores'))<>4
      or (select count(*) from jsonb_object_keys(v_item->'rationales'))<>4
      or (v_item->'option_scores'->(v_item->>'scoring_key')) is distinct from '3'::jsonb then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
    for v_option in select * from jsonb_array_elements(v_item->'options') loop
      if coalesce(v_option->>'id','') not in ('A','B','C','D') or nullif(v_option->>'text','') is null
        or coalesce(v_item->'option_scores'->(v_option->>'id'),'null'::jsonb) not in ('0'::jsonb,'1'::jsonb,'2'::jsonb,'3'::jsonb)
        or nullif(v_item->'rationales'->>(v_option->>'id'),'') is null then
        raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
      end if;
    end loop;
    for v_link in select * from jsonb_array_elements(v_item->'key_action_codes') loop
      if not exists(select 1 from jsonb_array_elements(p_manifest->'key_actions') where value->>'code'=v_link#>>'{}' and value->>'competency_code'=v_item->>'competency_code') then
        raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
      end if;
    end loop;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_manifest->'key_actions') action
    where not exists(select 1 from jsonb_array_elements(v_config->'self_report_items') item where item->>'key_action_code'=action->>'code')
      and not exists(select 1 from jsonb_array_elements(v_config->'sjt_items') item where item->'key_action_codes' ? (action->>'code'))) then
    raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
  end if;
  for v_map in select * from jsonb_array_elements(p_manifest->'catalog_crosswalks') loop
    if v_map->>'status' is distinct from 'proposed' or not exists(select 1 from jsonb_array_elements(v_config->'competencies') where value->>'code'=v_map->>'pe_code') then
      raise exception 'PE_INSTRUMENT_STRUCTURE_INVALID';
    end if;
    if not exists(select 1 from public.competency_dictionary where framework_id=v_map->>'framework_id' and code=v_map->>'catalog_code') then
      raise exception 'PE_CATALOG_PREREQUISITE: run SQL 63 first';
    end if;
  end loop;
  select * into v_existing from public.pe_instrument_versions where instrument_id=v_id and version=v_version;
  if found and (v_existing.manifest<>p_manifest or v_existing.bundle_sha256<>p_bundle_sha256) then
    raise exception 'PE_SOURCE_CONFLICT: create a new version';
  end if;
  insert into public.pe_instrument_versions(instrument_id,version,bundle_sha256,manifest)
    values(v_id,v_version,p_bundle_sha256,p_manifest) on conflict(instrument_id,version) do nothing;
  for v_map in select * from jsonb_array_elements(p_manifest->'catalog_crosswalks') loop
    insert into public.pe_catalog_crosswalks(instrument_id,instrument_version,pe_code,framework_id,catalog_code)
      values(v_id,v_version,v_map->>'pe_code',v_map->>'framework_id',v_map->>'catalog_code')
      on conflict(instrument_id,instrument_version,pe_code) do nothing;
  end loop;
  return true;
end;
$$;

-- No CEO content here: the repository is public. Install the private seed locally.

alter table public.pe_instrument_versions enable row level security;
alter table public.pe_catalog_crosswalks enable row level security;
alter table public.pe_attempts enable row level security;
alter table public.pe_audit_events enable row level security;
revoke all on public.pe_instrument_versions,public.pe_catalog_crosswalks,public.pe_attempts,public.pe_audit_events from public,anon,authenticated,service_role;
grant select on public.pe_instrument_versions,public.pe_catalog_crosswalks,public.pe_attempts,public.pe_audit_events to service_role;
-- Service-role writes must use the guarded RPCs; no direct inserts/updates/deletes.
revoke all on function public.pe_reject_instrument_mutation() from public,anon,authenticated,service_role;
revoke all on function public.pe_register_draft_instrument_v1(jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.pe_score_responses(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.pe_attempt_dto(public.pe_attempts) from public,anon,authenticated,service_role;
revoke all on function public.pe_start_internal_attempt(uuid,uuid,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.pe_get_internal_attempt(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pe_write_internal_attempt(uuid,uuid,uuid,int,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.pe_delete_internal_attempt(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.pe_start_internal_attempt(uuid,uuid,uuid,text,text,timestamptz,timestamptz),
  public.pe_get_internal_attempt(uuid,uuid,uuid),public.pe_write_internal_attempt(uuid,uuid,uuid,int,jsonb,text),
  public.pe_delete_internal_attempt(uuid,uuid,uuid) to service_role;

commit;
