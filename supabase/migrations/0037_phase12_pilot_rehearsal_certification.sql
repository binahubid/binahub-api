-- Phase 12: evidence-bound pilot rehearsal and final human acceptance certification.
-- This migration never activates n8n, changes environment variables, or sends outbound messages.

begin;

create table if not exists public.pilot_rehearsals (
  id uuid primary key default gen_random_uuid(),
  rehearsal_key text not null unique,
  pilot_release_id uuid not null references public.pilot_release_plans(id) on delete cascade,
  monitoring_snapshot_id uuid references public.pilot_monitoring_snapshots(id) on delete set null,
  title text not null,
  environment text not null default 'staging',
  status text not null default 'planned',
  owner text,
  approver text,
  summary text,
  rollback_result text,
  failure_reason text,
  dry_run boolean not null default true,
  is_mock boolean not null default true,
  started_at timestamptz,
  finished_at timestamptz,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pilot_rehearsals_key_valid check (
    rehearsal_key = lower(btrim(rehearsal_key))
    and rehearsal_key ~ '^[a-z][a-z0-9_-]{2,79}$'
  ),
  constraint pilot_rehearsals_environment_valid check (environment in ('local', 'staging', 'production')),
  constraint pilot_rehearsals_status_valid check (status in ('planned', 'in_progress', 'passed', 'failed', 'aborted')),
  constraint pilot_rehearsals_dry_run_only check (dry_run = true),
  constraint pilot_rehearsals_owner_valid check (
    owner is null or (length(btrim(owner)) between 3 and 320 and owner = lower(btrim(owner)))
  ),
  constraint pilot_rehearsals_approver_valid check (
    approver is null or (length(btrim(approver)) between 3 and 320 and approver = lower(btrim(approver)))
  ),
  constraint pilot_rehearsals_real_owner_valid check (is_mock or (owner is not null and approver is not null)),
  constraint pilot_rehearsals_terminal_valid check (
    status not in ('passed', 'failed', 'aborted')
    or (started_at is not null and finished_at is not null and finished_at >= started_at)
  ),
  constraint pilot_rehearsals_passed_valid check (
    status <> 'passed'
    or (
      is_mock = false
      and environment = 'production'
      and monitoring_snapshot_id is not null
      and summary is not null and length(btrim(summary)) >= 10
      and rollback_result is not null and length(btrim(rollback_result)) >= 10
    )
  ),
  constraint pilot_rehearsals_failed_valid check (
    status not in ('failed', 'aborted')
    or (failure_reason is not null and length(btrim(failure_reason)) >= 10)
  )
);

create index if not exists pilot_rehearsals_release_idx
  on public.pilot_rehearsals (pilot_release_id, created_at desc);
create index if not exists pilot_rehearsals_status_idx
  on public.pilot_rehearsals (status, updated_at desc);

create table if not exists public.pilot_rehearsal_steps (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references public.pilot_rehearsals(id) on delete cascade,
  step_key text not null,
  title text not null,
  description text not null,
  expected_result text not null,
  sort_order integer not null,
  required boolean not null default true,
  status text not null default 'pending',
  owner text,
  evidence_note text,
  evidence_url text,
  actual_result text,
  blocker_reason text,
  last_tested_at timestamptz,
  last_tested_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rehearsal_id, step_key),
  constraint pilot_rehearsal_steps_key_valid check (step_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint pilot_rehearsal_steps_status_valid check (status in ('pending', 'running', 'passed', 'failed', 'blocked')),
  constraint pilot_rehearsal_steps_owner_valid check (
    owner is null or (length(btrim(owner)) between 3 and 320 and owner = lower(btrim(owner)))
  ),
  constraint pilot_rehearsal_steps_active_owner_valid check (
    status = 'pending' or owner is not null
  ),
  constraint pilot_rehearsal_steps_evidence_valid check (
    status not in ('passed', 'failed')
    or (
      evidence_note is not null and length(btrim(evidence_note)) >= 5
      and actual_result is not null and length(btrim(actual_result)) >= 5
      and last_tested_at is not null
      and last_tested_by is not null
    )
  ),
  constraint pilot_rehearsal_steps_blocker_valid check (
    status <> 'blocked' or (blocker_reason is not null and length(btrim(blocker_reason)) >= 5)
  ),
  constraint pilot_rehearsal_steps_evidence_url_valid check (
    evidence_url is null or evidence_url ~* '^https://[^[:space:]]+$'
  )
);

create index if not exists pilot_rehearsal_steps_queue_idx
  on public.pilot_rehearsal_steps (rehearsal_id, required desc, sort_order);

create table if not exists public.pilot_rehearsal_events (
  id uuid primary key default gen_random_uuid(),
  rehearsal_id uuid not null references public.pilot_rehearsals(id) on delete cascade,
  step_id uuid references public.pilot_rehearsal_steps(id) on delete set null,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint pilot_rehearsal_events_type_valid check (
    event_type in ('created', 'plan_updated', 'started', 'step_updated', 'passed', 'failed', 'aborted')
  ),
  constraint pilot_rehearsal_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists pilot_rehearsal_events_rehearsal_idx
  on public.pilot_rehearsal_events (rehearsal_id, created_at desc);

create table if not exists public.pilot_acceptance_certifications (
  id uuid primary key default gen_random_uuid(),
  pilot_release_id uuid not null unique references public.pilot_release_plans(id) on delete cascade,
  rehearsal_id uuid not null references public.pilot_rehearsals(id) on delete restrict,
  monitoring_snapshot_id uuid not null references public.pilot_monitoring_snapshots(id) on delete restrict,
  decision text not null,
  conditions jsonb not null default '[]'::jsonb,
  decision_note text not null,
  uat_evidence_snapshot jsonb not null,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  is_mock boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  constraint pilot_acceptance_decision_valid check (decision in ('accepted', 'accepted_with_conditions', 'rejected')),
  constraint pilot_acceptance_conditions_array check (jsonb_typeof(conditions) = 'array'),
  constraint pilot_acceptance_uat_array check (jsonb_typeof(uat_evidence_snapshot) = 'array'),
  constraint pilot_acceptance_note_valid check (length(btrim(decision_note)) >= 10),
  constraint pilot_acceptance_actor_valid check (
    length(btrim(decided_by)) between 3 and 320 and decided_by = lower(btrim(decided_by))
  ),
  constraint pilot_acceptance_conditions_valid check (
    decision <> 'accepted_with_conditions' or jsonb_array_length(conditions) > 0
  ),
  constraint pilot_acceptance_real_valid check (
    decision = 'rejected' or is_mock = false
  ),
  constraint pilot_acceptance_version_valid check (version >= 1)
);

create table if not exists public.pilot_acceptance_events (
  id uuid primary key default gen_random_uuid(),
  certification_id uuid not null references public.pilot_acceptance_certifications(id) on delete cascade,
  pilot_release_id uuid not null references public.pilot_release_plans(id) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint pilot_acceptance_events_type_valid check (event_type in ('certified', 'recertified', 'rejected')),
  constraint pilot_acceptance_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists pilot_acceptance_events_release_idx
  on public.pilot_acceptance_events (pilot_release_id, created_at desc);

drop trigger if exists pilot_rehearsals_set_updated_at on public.pilot_rehearsals;
create trigger pilot_rehearsals_set_updated_at
before update on public.pilot_rehearsals
for each row execute function public.set_updated_at();

drop trigger if exists pilot_rehearsal_steps_set_updated_at on public.pilot_rehearsal_steps;
create trigger pilot_rehearsal_steps_set_updated_at
before update on public.pilot_rehearsal_steps
for each row execute function public.set_updated_at();

drop trigger if exists pilot_acceptance_certifications_set_updated_at on public.pilot_acceptance_certifications;
create trigger pilot_acceptance_certifications_set_updated_at
before update on public.pilot_acceptance_certifications
for each row execute function public.set_updated_at();

alter table public.pilot_rehearsals enable row level security;
alter table public.pilot_rehearsal_steps enable row level security;
alter table public.pilot_rehearsal_events enable row level security;
alter table public.pilot_acceptance_certifications enable row level security;
alter table public.pilot_acceptance_events enable row level security;

revoke all on table
  public.pilot_rehearsals,
  public.pilot_rehearsal_steps,
  public.pilot_rehearsal_events,
  public.pilot_acceptance_certifications,
  public.pilot_acceptance_events
from public, anon, authenticated;

grant select, insert, update on table public.pilot_rehearsals to service_role;
grant select, insert, update on table public.pilot_rehearsal_steps to service_role;
grant select, insert on table public.pilot_rehearsal_events to service_role;
grant select, insert, update on table public.pilot_acceptance_certifications to service_role;
grant select, insert on table public.pilot_acceptance_events to service_role;

create or replace function public.save_pilot_rehearsal(
  p_rehearsal_id uuid,
  p_release_id uuid,
  p_rehearsal_key text,
  p_title text,
  p_environment text,
  p_owner text,
  p_approver text,
  p_is_mock boolean,
  p_actor text
)
returns public.pilot_rehearsals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  release_record public.pilot_release_plans%rowtype;
  before_record public.pilot_rehearsals%rowtype;
  saved public.pilot_rehearsals%rowtype;
  normalized_key text := lower(btrim(coalesce(p_rehearsal_key, '')));
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
  normalized_approver text := nullif(lower(btrim(coalesce(p_approver, ''))), '');
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
begin
  if length(normalized_actor) < 3 then raise exception 'REHEARSAL_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if normalized_key !~ '^[a-z][a-z0-9_-]{2,79}$' then raise exception 'REHEARSAL_KEY_INVALID' using errcode = '22023'; end if;
  if length(normalized_title) < 5 then raise exception 'REHEARSAL_TITLE_REQUIRED' using errcode = '22023'; end if;
  if p_environment not in ('local', 'staging', 'production') then raise exception 'REHEARSAL_ENVIRONMENT_INVALID' using errcode = '22023'; end if;
  if not coalesce(p_is_mock, true) and (normalized_owner is null or normalized_approver is null) then
    raise exception 'REHEARSAL_OWNERS_REQUIRED' using errcode = '22023';
  end if;

  select * into release_record from public.pilot_release_plans where id = p_release_id;
  if release_record.id is null then raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not coalesce(p_is_mock, true) and (release_record.is_mock or release_record.status not in ('approved', 'scheduled')) then
    raise exception 'REHEARSAL_APPROVED_RELEASE_REQUIRED' using errcode = '55000';
  end if;

  if p_rehearsal_id is null then
    insert into public.pilot_rehearsals (
      rehearsal_key, pilot_release_id, title, environment, owner, approver, is_mock, dry_run, created_by, updated_by
    ) values (
      normalized_key, p_release_id, normalized_title, p_environment,
      normalized_owner, normalized_approver, coalesce(p_is_mock, true), true, normalized_actor, normalized_actor
    ) returning * into saved;

    insert into public.pilot_rehearsal_steps (
      rehearsal_id, step_key, title, description, expected_result, sort_order, required
    ) values
      (saved.id, 'environment_guard', 'Verifikasi environment guard', 'Periksa keempat environment dry-run dan runtime ceiling database.', 'Semua environment tetap dry-run dan tidak ada requested mode yang melampaui approval.', 10, true),
      (saved.id, 'follow_up_dry_run', 'Follow-up Scheduler dry-run', 'Jalankan scheduler dengan data uji tanpa mengirim email.', 'Run tercatat sukses, kandidat dapat diperiksa, dan outbound tetap nol.', 20, true),
      (saved.id, 'event_worker_dry_run', 'Transformation Worker dry-run', 'Jalankan event worker dengan event uji dan duplicate delivery.', 'Retry/idempotensi terverifikasi dan tidak ada mutasi live yang tidak disetujui.', 30, true),
      (saved.id, 'client_operations_dry_run', 'Client Operations dry-run', 'Jalankan client operations terhadap kandidat uji.', 'Kandidat dan task preview dapat direkonsiliasi tanpa side effect live.', 40, true),
      (saved.id, 'acquisition_dry_run', 'Acquisition Processor dry-run', 'Jalankan batch acquisition yang disetujui dengan data uji.', 'Dedupe, suppression, dan batas batch bekerja tanpa outreach.', 50, true),
      (saved.id, 'retry_idempotency', 'Retry dan idempotensi', 'Ulangi request identik dan simulasi kegagalan yang dapat dipulihkan.', 'Tidak ada data ganda; retry memiliki audit trail dan hasil deterministik.', 60, true),
      (saved.id, 'incident_kill_switch', 'Incident drill dan kill switch', 'Simulasikan finding critical dan jalankan prosedur penghentian.', 'Incident memblokir pilot dan owner dapat menjalankan kill switch sesuai runbook.', 70, true),
      (saved.id, 'recovery_reconciliation', 'Recovery dan rekonsiliasi', 'Pulihkan kondisi dry-run dan rekonsiliasi database, n8n, serta snapshot.', 'Tidak ada orphan state; seluruh kontrol kembali aman dan bukti tersimpan.', 80, true);

    insert into public.pilot_rehearsal_events (
      rehearsal_id, event_type, actor, after_snapshot, note
    ) values (
      saved.id, 'created', normalized_actor, to_jsonb(saved),
      'Rehearsal dry-run dibuat dengan delapan langkah wajib.'
    );
    return saved;
  end if;

  select * into before_record from public.pilot_rehearsals where id = p_rehearsal_id for update;
  if before_record.id is null then raise exception 'REHEARSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if before_record.status <> 'planned' then raise exception 'REHEARSAL_PLAN_LOCKED' using errcode = '55000'; end if;
  if before_record.pilot_release_id <> p_release_id then raise exception 'REHEARSAL_RELEASE_IMMUTABLE' using errcode = '55000'; end if;

  update public.pilot_rehearsals
  set rehearsal_key = normalized_key,
      title = normalized_title,
      environment = p_environment,
      owner = normalized_owner,
      approver = normalized_approver,
      is_mock = coalesce(p_is_mock, true),
      updated_by = normalized_actor
  where id = before_record.id
  returning * into saved;

  insert into public.pilot_rehearsal_events (
    rehearsal_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id, 'plan_updated', normalized_actor, to_jsonb(before_record), to_jsonb(saved),
    'Rencana rehearsal diperbarui sebelum dimulai.'
  );
  return saved;
end;
$$;

create or replace function public.update_pilot_rehearsal_step(
  p_step_id uuid,
  p_actor text,
  p_status text,
  p_owner text,
  p_evidence_note text,
  p_evidence_url text,
  p_actual_result text,
  p_blocker_reason text
)
returns public.pilot_rehearsal_steps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rehearsal_record public.pilot_rehearsals%rowtype;
  before_record public.pilot_rehearsal_steps%rowtype;
  saved public.pilot_rehearsal_steps%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
  normalized_evidence text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  normalized_url text := nullif(btrim(coalesce(p_evidence_url, '')), '');
  normalized_actual text := nullif(btrim(coalesce(p_actual_result, '')), '');
  normalized_blocker text := nullif(btrim(coalesce(p_blocker_reason, '')), '');
begin
  if length(normalized_actor) < 3 then raise exception 'REHEARSAL_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_status not in ('pending', 'running', 'passed', 'failed', 'blocked') then
    raise exception 'REHEARSAL_STEP_STATUS_INVALID' using errcode = '22023';
  end if;
  if p_status <> 'pending' and normalized_owner is null then raise exception 'REHEARSAL_STEP_OWNER_REQUIRED' using errcode = '22023'; end if;
  if p_status in ('passed', 'failed') and (
    coalesce(length(normalized_evidence), 0) < 5 or coalesce(length(normalized_actual), 0) < 5
  ) then raise exception 'REHEARSAL_STEP_EVIDENCE_REQUIRED' using errcode = '22023'; end if;
  if p_status = 'blocked' and coalesce(length(normalized_blocker), 0) < 5 then
    raise exception 'REHEARSAL_STEP_BLOCKER_REQUIRED' using errcode = '22023';
  end if;
  if normalized_url is not null and normalized_url !~* '^https://[^[:space:]]+$' then
    raise exception 'REHEARSAL_STEP_URL_INVALID' using errcode = '22023';
  end if;

  select * into before_record from public.pilot_rehearsal_steps where id = p_step_id for update;
  if before_record.id is null then raise exception 'REHEARSAL_STEP_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into rehearsal_record from public.pilot_rehearsals where id = before_record.rehearsal_id;
  if rehearsal_record.status <> 'in_progress' then raise exception 'REHEARSAL_NOT_IN_PROGRESS' using errcode = '55000'; end if;

  update public.pilot_rehearsal_steps
  set status = p_status,
      owner = normalized_owner,
      evidence_note = normalized_evidence,
      evidence_url = normalized_url,
      actual_result = normalized_actual,
      blocker_reason = case when p_status = 'blocked' then normalized_blocker else null end,
      last_tested_at = case when p_status in ('passed', 'failed') then now() else last_tested_at end,
      last_tested_by = case when p_status in ('passed', 'failed') then normalized_actor else last_tested_by end,
      updated_by = normalized_actor
  where id = before_record.id
  returning * into saved;

  insert into public.pilot_rehearsal_events (
    rehearsal_id, step_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.rehearsal_id, saved.id, 'step_updated', normalized_actor,
    to_jsonb(before_record), to_jsonb(saved), coalesce(normalized_blocker, normalized_evidence, 'Langkah rehearsal diperbarui.')
  );
  return saved;
end;
$$;

create or replace function public.transition_pilot_rehearsal(
  p_rehearsal_id uuid,
  p_actor text,
  p_status text,
  p_snapshot_id uuid,
  p_summary text,
  p_rollback_result text,
  p_failure_reason text
)
returns public.pilot_rehearsals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.pilot_rehearsals%rowtype;
  saved public.pilot_rehearsals%rowtype;
  snapshot_record public.pilot_monitoring_snapshots%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_summary text := nullif(btrim(coalesce(p_summary, '')), '');
  normalized_rollback text := nullif(btrim(coalesce(p_rollback_result, '')), '');
  normalized_failure text := nullif(btrim(coalesce(p_failure_reason, '')), '');
begin
  if length(normalized_actor) < 3 then raise exception 'REHEARSAL_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_status not in ('in_progress', 'passed', 'failed', 'aborted') then
    raise exception 'REHEARSAL_TRANSITION_INVALID' using errcode = '22023';
  end if;
  select * into before_record from public.pilot_rehearsals where id = p_rehearsal_id for update;
  if before_record.id is null then raise exception 'REHEARSAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if not (
    (before_record.status = 'planned' and p_status = 'in_progress')
    or (before_record.status in ('failed', 'aborted') and p_status = 'in_progress')
    or (before_record.status = 'in_progress' and p_status in ('passed', 'failed', 'aborted'))
  ) then raise exception 'REHEARSAL_STATUS_TRANSITION_INVALID' using errcode = '55000'; end if;

  if p_status = 'in_progress' and (
    before_record.owner is null or before_record.approver is null
  ) then raise exception 'REHEARSAL_OWNERS_REQUIRED' using errcode = '55000'; end if;

  if p_status = 'passed' then
    if before_record.is_mock or before_record.environment <> 'production' then
      raise exception 'REHEARSAL_REAL_PRODUCTION_REQUIRED' using errcode = '55000';
    end if;
    if coalesce(length(normalized_summary), 0) < 10 or coalesce(length(normalized_rollback), 0) < 10 then
      raise exception 'REHEARSAL_COMPLETION_EVIDENCE_REQUIRED' using errcode = '22023';
    end if;
    if (select count(*) from public.pilot_rehearsal_steps where rehearsal_id = before_record.id and required) <> 8
      or exists (
        select 1 from public.pilot_rehearsal_steps
        where rehearsal_id = before_record.id and required and status <> 'passed'
      ) then raise exception 'REHEARSAL_REQUIRED_STEPS_INCOMPLETE' using errcode = '55000'; end if;
    select * into snapshot_record from public.pilot_monitoring_snapshots where id = p_snapshot_id;
    if snapshot_record.id is null
      or snapshot_record.pilot_release_id is distinct from before_record.pilot_release_id
      or snapshot_record.is_mock
      or snapshot_record.evaluated_at < now() - interval '24 hours'
      or snapshot_record.overall_status in ('critical', 'insufficient_data') then
      raise exception 'REHEARSAL_FRESH_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
  elsif p_status in ('failed', 'aborted') and coalesce(length(normalized_failure), 0) < 10 then
    raise exception 'REHEARSAL_FAILURE_REASON_REQUIRED' using errcode = '22023';
  end if;

  update public.pilot_rehearsals
  set status = p_status,
      monitoring_snapshot_id = case when p_status = 'passed' then p_snapshot_id else monitoring_snapshot_id end,
      summary = case when p_status = 'passed' then normalized_summary else summary end,
      rollback_result = case when p_status = 'passed' then normalized_rollback else rollback_result end,
      failure_reason = case when p_status in ('failed', 'aborted') then normalized_failure else null end,
      started_at = case when p_status = 'in_progress' then now() else started_at end,
      finished_at = case when p_status in ('passed', 'failed', 'aborted') then now() else null end,
      updated_by = normalized_actor
  where id = before_record.id
  returning * into saved;

  insert into public.pilot_rehearsal_events (
    rehearsal_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id, case p_status when 'in_progress' then 'started' else p_status end,
    normalized_actor, to_jsonb(before_record), to_jsonb(saved),
    coalesce(normalized_failure, normalized_summary, 'Rehearsal dimulai dalam dry-run.')
  );
  return saved;
end;
$$;

create or replace function public.record_pilot_acceptance_certification(
  p_release_id uuid,
  p_rehearsal_id uuid,
  p_snapshot_id uuid,
  p_actor text,
  p_decision text,
  p_conditions jsonb,
  p_decision_note text,
  p_is_mock boolean
)
returns public.pilot_acceptance_certifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  release_record public.pilot_release_plans%rowtype;
  rehearsal_record public.pilot_rehearsals%rowtype;
  snapshot_record public.pilot_monitoring_snapshots%rowtype;
  before_record public.pilot_acceptance_certifications%rowtype;
  saved public.pilot_acceptance_certifications%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_note text := btrim(coalesce(p_decision_note, ''));
  normalized_conditions jsonb := coalesce(p_conditions, '[]'::jsonb);
  uat_snapshot jsonb;
begin
  if length(normalized_actor) < 3 then raise exception 'CERTIFICATION_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_decision not in ('accepted', 'accepted_with_conditions', 'rejected') then
    raise exception 'CERTIFICATION_DECISION_INVALID' using errcode = '22023';
  end if;
  if length(normalized_note) < 10 then raise exception 'CERTIFICATION_NOTE_REQUIRED' using errcode = '22023'; end if;
  if jsonb_typeof(normalized_conditions) <> 'array' then raise exception 'CERTIFICATION_CONDITIONS_INVALID' using errcode = '22023'; end if;
  if p_decision = 'accepted_with_conditions' and jsonb_array_length(normalized_conditions) = 0 then
    raise exception 'CERTIFICATION_CONDITIONS_REQUIRED' using errcode = '22023';
  end if;
  if p_decision in ('accepted', 'accepted_with_conditions') and coalesce(p_is_mock, true) then
    raise exception 'CERTIFICATION_REAL_EVIDENCE_REQUIRED' using errcode = '55000';
  end if;

  select * into release_record from public.pilot_release_plans where id = p_release_id for update;
  if release_record.id is null then raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002'; end if;
  if release_record.is_mock or release_record.status not in ('approved', 'scheduled') then
    raise exception 'CERTIFICATION_APPROVED_RELEASE_REQUIRED' using errcode = '55000';
  end if;
  select * into before_record from public.pilot_acceptance_certifications where pilot_release_id = release_record.id;
  if before_record.id is not null and exists (
    select 1 from public.automation_runtime_controls
    where pilot_release_id = release_record.id and requested_mode in ('pilot', 'live')
  ) then raise exception 'CERTIFICATION_RUNTIME_ACTIVE' using errcode = '55000'; end if;

  select * into rehearsal_record from public.pilot_rehearsals where id = p_rehearsal_id;
  select * into snapshot_record from public.pilot_monitoring_snapshots where id = p_snapshot_id;
  if rehearsal_record.id is null
    or rehearsal_record.pilot_release_id <> release_record.id
    or snapshot_record.id is null
    or snapshot_record.pilot_release_id is distinct from release_record.id then
    raise exception 'CERTIFICATION_EVIDENCE_REFERENCE_INVALID' using errcode = '55000';
  end if;
  if p_decision in ('accepted', 'accepted_with_conditions') then
    if rehearsal_record.status <> 'passed'
      or rehearsal_record.is_mock
      or rehearsal_record.environment <> 'production'
      or rehearsal_record.monitoring_snapshot_id is distinct from p_snapshot_id then
      raise exception 'CERTIFICATION_REHEARSAL_INVALID' using errcode = '55000';
    end if;
    if snapshot_record.is_mock
      or snapshot_record.evaluated_at < now() - interval '24 hours'
      or snapshot_record.overall_status in ('critical', 'insufficient_data') then
      raise exception 'CERTIFICATION_SNAPSHOT_INVALID' using errcode = '55000';
    end if;
    if (select count(*) from public.uat_scenarios where required) < 12
      or exists (select 1 from public.uat_scenarios where required and status <> 'passed') then
      raise exception 'CERTIFICATION_UAT_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_monitoring_policies
      where not enabled or is_mock or owner is null
    ) or (select count(*) from public.automation_monitoring_policies) <> 4 then
      raise exception 'CERTIFICATION_POLICIES_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed') and severity = 'critical'
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then raise exception 'CERTIFICATION_CRITICAL_INCIDENT_OPEN' using errcode = '55000'; end if;
  end if;
  if p_decision = 'accepted' then
    if snapshot_record.overall_status <> 'healthy' or jsonb_array_length(snapshot_record.blockers) > 0 then
      raise exception 'CERTIFICATION_HEALTHY_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed') and severity in ('high', 'critical')
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then raise exception 'CERTIFICATION_HIGH_INCIDENT_OPEN' using errcode = '55000'; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'scenarioId', scenario.id,
    'scenarioKey', scenario.scenario_key,
    'required', scenario.required,
    'status', scenario.status,
    'owner', scenario.owner,
    'environment', scenario.environment,
    'evidenceNote', scenario.evidence_note,
    'evidenceUrl', scenario.evidence_url,
    'actualResult', scenario.actual_result,
    'lastTestedAt', scenario.last_tested_at,
    'lastTestedBy', scenario.last_tested_by,
    'updatedAt', scenario.updated_at
  ) order by scenario.sort_order), '[]'::jsonb)
  into uat_snapshot
  from public.uat_scenarios scenario;

  insert into public.pilot_acceptance_certifications (
    pilot_release_id, rehearsal_id, monitoring_snapshot_id, decision, conditions,
    decision_note, uat_evidence_snapshot, decided_by, decided_at, is_mock, version
  ) values (
    release_record.id, p_rehearsal_id, p_snapshot_id, p_decision, normalized_conditions,
    normalized_note, uat_snapshot, normalized_actor, now(), coalesce(p_is_mock, true), 1
  )
  on conflict (pilot_release_id) do update
  set rehearsal_id = excluded.rehearsal_id,
      monitoring_snapshot_id = excluded.monitoring_snapshot_id,
      decision = excluded.decision,
      conditions = excluded.conditions,
      decision_note = excluded.decision_note,
      uat_evidence_snapshot = excluded.uat_evidence_snapshot,
      decided_by = excluded.decided_by,
      decided_at = excluded.decided_at,
      is_mock = excluded.is_mock,
      version = public.pilot_acceptance_certifications.version + 1
  returning * into saved;

  insert into public.pilot_acceptance_events (
    certification_id, pilot_release_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    saved.id, saved.pilot_release_id,
    case when saved.decision = 'rejected' then 'rejected' when before_record.id is null then 'certified' else 'recertified' end,
    normalized_actor, coalesce(to_jsonb(before_record), '{}'::jsonb), to_jsonb(saved), normalized_note
  );
  return saved;
end;
$$;

create or replace function public.enforce_phase12_acceptance_review_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  certification_decision text;
begin
  if new.decision in ('go', 'conditional_go') then
    select decision into certification_decision
    from public.pilot_acceptance_certifications
    where pilot_release_id = new.pilot_release_id
      and monitoring_snapshot_id = new.monitoring_snapshot_id
      and is_mock = false;
    if new.decision = 'go' and coalesce(certification_decision, '') <> 'accepted' then
      raise exception 'GO_NO_GO_ACCEPTANCE_REQUIRED' using errcode = '55000';
    end if;
    if new.decision = 'conditional_go' and coalesce(certification_decision, '') not in ('accepted', 'accepted_with_conditions') then
      raise exception 'GO_NO_GO_ACCEPTANCE_REQUIRED' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pilot_go_no_go_reviews_phase12_acceptance_gate on public.pilot_go_no_go_reviews;
create trigger pilot_go_no_go_reviews_phase12_acceptance_gate
before insert or update on public.pilot_go_no_go_reviews
for each row execute function public.enforce_phase12_acceptance_review_gate();

create or replace function public.enforce_phase12_acceptance_schedule_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'scheduled' and old.status is distinct from new.status and not exists (
    select 1 from public.pilot_acceptance_certifications
    where pilot_release_id = new.id
      and decision in ('accepted', 'accepted_with_conditions')
      and is_mock = false
  ) then raise exception 'PILOT_ACCEPTANCE_CERTIFICATION_REQUIRED' using errcode = '55000'; end if;
  return new;
end;
$$;

drop trigger if exists pilot_release_plans_phase12_acceptance_gate on public.pilot_release_plans;
create trigger pilot_release_plans_phase12_acceptance_gate
before update on public.pilot_release_plans
for each row execute function public.enforce_phase12_acceptance_schedule_gate();

create or replace function public.enforce_phase12_acceptance_runtime_gate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  certification_decision text;
begin
  if new.requested_mode in ('pilot', 'live') and (
    old.requested_mode is distinct from new.requested_mode
    or old.pilot_release_id is distinct from new.pilot_release_id
  ) then
    select decision into certification_decision
    from public.pilot_acceptance_certifications
    where pilot_release_id = new.pilot_release_id and is_mock = false;
    if new.requested_mode = 'pilot' and coalesce(certification_decision, '') not in ('accepted', 'accepted_with_conditions') then
      raise exception 'RUNTIME_ACCEPTANCE_CERTIFICATION_REQUIRED' using errcode = '55000';
    end if;
    if new.requested_mode = 'live' and coalesce(certification_decision, '') <> 'accepted' then
      raise exception 'RUNTIME_ACCEPTANCE_CERTIFICATION_REQUIRED' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists automation_runtime_controls_phase12_acceptance_gate on public.automation_runtime_controls;
create trigger automation_runtime_controls_phase12_acceptance_gate
before update on public.automation_runtime_controls
for each row execute function public.enforce_phase12_acceptance_runtime_gate();

revoke all on function public.save_pilot_rehearsal(uuid,uuid,text,text,text,text,text,boolean,text)
  from public, anon, authenticated;
revoke all on function public.update_pilot_rehearsal_step(uuid,text,text,text,text,text,text,text)
  from public, anon, authenticated;
revoke all on function public.transition_pilot_rehearsal(uuid,text,text,uuid,text,text,text)
  from public, anon, authenticated;
revoke all on function public.record_pilot_acceptance_certification(uuid,uuid,uuid,text,text,jsonb,text,boolean)
  from public, anon, authenticated;

grant execute on function public.save_pilot_rehearsal(uuid,uuid,text,text,text,text,text,boolean,text)
  to service_role;
grant execute on function public.update_pilot_rehearsal_step(uuid,text,text,text,text,text,text,text)
  to service_role;
grant execute on function public.transition_pilot_rehearsal(uuid,text,text,uuid,text,text,text)
  to service_role;
grant execute on function public.record_pilot_acceptance_certification(uuid,uuid,uuid,text,text,jsonb,text,boolean)
  to service_role;

comment on table public.pilot_rehearsals is
  'Human-owned production dry-run rehearsal. A passed rehearsal is evidence only and cannot activate automation.';
comment on table public.pilot_acceptance_certifications is
  'Final human acceptance bound to UAT evidence, rehearsal, release, and a fresh monitoring snapshot.';

commit;
