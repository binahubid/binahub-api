-- Phase 9: human UAT evidence and pilot readiness gate.
-- This migration records test evidence only. It does not activate automation.

begin;

create table if not exists public.uat_scenarios (
  id uuid primary key default gen_random_uuid(),
  scenario_key text not null unique,
  category text not null,
  title text not null,
  objective text not null,
  expected_result text not null,
  required boolean not null default true,
  status text not null default 'not_started',
  owner text,
  environment text not null default 'staging',
  evidence_note text,
  evidence_url text,
  actual_result text,
  blocker_reason text,
  last_tested_at timestamptz,
  last_tested_by text,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'system-migration',
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uat_scenarios_key_valid check (
    scenario_key = lower(btrim(scenario_key))
    and scenario_key ~ '^[a-z][a-z0-9_]{2,79}$'
  ),
  constraint uat_scenarios_category_valid check (
    category in (
      'public_funnel', 'security_access', 'sales_proposal', 'calendar',
      'deliverability', 'client_delivery', 'retention', 'accessibility', 'operations'
    )
  ),
  constraint uat_scenarios_status_valid check (
    status in ('not_started', 'in_progress', 'passed', 'failed', 'blocked', 'not_applicable')
  ),
  constraint uat_scenarios_environment_valid check (environment in ('local', 'staging', 'production')),
  constraint uat_scenarios_owner_valid check (
    owner is null or (length(btrim(owner)) between 3 and 320 and owner = lower(btrim(owner)))
  ),
  constraint uat_scenarios_active_owner_valid check (
    status not in ('in_progress', 'passed', 'failed', 'blocked') or owner is not null
  ),
  constraint uat_scenarios_evidence_valid check (
    status not in ('passed', 'failed')
    or (
      evidence_note is not null and length(btrim(evidence_note)) >= 5
      and actual_result is not null and length(btrim(actual_result)) >= 5
      and last_tested_at is not null
      and last_tested_by is not null
    )
  ),
  constraint uat_scenarios_blocker_valid check (
    status <> 'blocked' or (blocker_reason is not null and length(btrim(blocker_reason)) >= 5)
  ),
  constraint uat_scenarios_required_valid check (not (required and status = 'not_applicable')),
  constraint uat_scenarios_evidence_url_valid check (
    evidence_url is null or evidence_url ~* '^https://[^[:space:]]+$'
  )
);

create index if not exists uat_scenarios_queue_idx
  on public.uat_scenarios (required desc, status, sort_order, created_at);
create index if not exists uat_scenarios_owner_idx
  on public.uat_scenarios (owner, status, updated_at desc)
  where owner is not null;

create table if not exists public.uat_scenario_events (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.uat_scenarios(id) on delete cascade,
  event_type text not null,
  actor text not null,
  before_snapshot jsonb not null default '{}'::jsonb,
  after_snapshot jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  constraint uat_scenario_events_type_valid check (
    event_type in ('created', 'status_changed', 'evidence_updated')
  ),
  constraint uat_scenario_events_actor_valid check (length(btrim(actor)) between 3 and 320)
);

create index if not exists uat_scenario_events_scenario_idx
  on public.uat_scenario_events (scenario_id, created_at desc);

drop trigger if exists uat_scenarios_set_updated_at on public.uat_scenarios;
create trigger uat_scenarios_set_updated_at
before update on public.uat_scenarios
for each row execute function public.set_updated_at();

alter table public.uat_scenarios enable row level security;
alter table public.uat_scenario_events enable row level security;

revoke all on table public.uat_scenarios, public.uat_scenario_events
from public, anon, authenticated;

grant select, insert, update on table public.uat_scenarios to service_role;
grant select, insert on table public.uat_scenario_events to service_role;

insert into public.uat_scenarios (
  scenario_key, category, title, objective, expected_result, required, sort_order
)
values
  (
    'public_assessment_pdf_email', 'public_funnel', 'Assessment publik, PDF, dan email hasil',
    'Menguji perjalanan pengguna anonim dari landing page sampai menerima hasil assessment.',
    'Assessment dapat diselesaikan tanpa login, data tersimpan satu kali, PDF rapi, dan email hasil diterima.',
    true, 10
  ),
  (
    'admin_role_boundaries', 'security_access', 'Batas akses dashboard dan API admin',
    'Memastikan data serta mutasi operasional hanya tersedia untuk administrator yang sah.',
    'Akses anonim dan role non-admin ditolak; administrator dapat membaca dan memperbarui data sesuai kontrak.',
    true, 20
  ),
  (
    'proposal_human_gate', 'sales_proposal', 'Proposal standar dan human gate custom',
    'Memastikan proposal standar dapat dipersiapkan tanpa melewati aturan persetujuan manusia.',
    'Proposal custom, diskon, nilai tinggi, confidence rendah, atau modul non-katalog selalu tertahan untuk review.',
    true, 30
  ),
  (
    'calcom_booking_lifecycle', 'calendar', 'Siklus booking konsultasi Cal.com',
    'Menguji booking, reschedule, cancellation, no-show, dan sinkronisasi opportunity.',
    'Setiap webhook valid tersimpan idempoten, lineage booking utuh, dan status opportunity sesuai lifecycle.',
    true, 40
  ),
  (
    'resend_delivery_webhook', 'deliverability', 'Pengiriman email dan webhook Resend',
    'Memastikan status delivered, bounced, complained, dan failed diproses aman.',
    'Webhook bertanda tangan valid tersimpan satu kali dan status delivery dapat diaudit tanpa kebocoran secret.',
    true, 50
  ),
  (
    'email_suppression_stop_rules', 'deliverability', 'Suppression, unsubscribe, dan stop conditions',
    'Memastikan alamat yang unsubscribe, bounce, atau complaint tidak dikirimi follow-up lanjutan.',
    'Scheduler mengabaikan suppressed contact dan mencatat alasan stop tanpa mengirim email.',
    true, 60
  ),
  (
    'won_to_client_handoff', 'client_delivery', 'Handoff deal menjadi client dan delivery',
    'Menguji konversi opportunity won menjadi account, project, owner, dan rencana delivery.',
    'Satu deal menghasilkan satu client handoff idempoten dengan owner komersial dan delivery yang jelas.',
    true, 70
  ),
  (
    'delivery_risk_human_tasks', 'operations', 'Risiko delivery menjadi human task',
    'Memastikan risiko, milestone overdue, dan SLA membentuk task manusia yang dapat ditindaklanjuti.',
    'Task tidak duplikat, memiliki prioritas dan tenggat, serta perubahan owner/status tercatat.',
    true, 80
  ),
  (
    'retention_repeat_loop', 'retention', 'Retain dan repeat opportunity',
    'Menguji account health, perubahan stakeholder, peluang renewal, upsell, dan kembali ke pipeline.',
    'Data stakeholder terbaru tersimpan dan repeat opportunity kembali ke qualification dengan jejak audit.',
    true, 90
  ),
  (
    'mobile_accessibility_core_flow', 'accessibility', 'Mobile dan aksesibilitas alur inti',
    'Memastikan assessment publik dan tugas admin inti dapat digunakan pada viewport utama dan keyboard.',
    'Tidak ada blocker kritis pada mobile, fokus keyboard terlihat, label form terbaca, dan error mudah dipahami.',
    true, 100
  ),
  (
    'automation_dry_run_audit', 'operations', 'Dry-run, retry, dan idempotensi automation',
    'Menguji seluruh workflow n8n dalam dry-run serta perilaku retry dan duplicate execution.',
    'Tidak ada pesan atau mutasi live; setiap run tercatat, kegagalan dapat diulang, dan duplikat tidak diproses ulang.',
    true, 110
  ),
  (
    'end_to_end_traceability', 'operations', 'Traceability proses end-to-end',
    'Menelusuri satu data uji dari awareness/prospect sampai client/retain menggunakan ID dan audit event.',
    'Setiap perpindahan tahap memiliki sumber, actor, waktu, status, dan referensi yang dapat direkonsiliasi.',
    true, 120
  )
on conflict (scenario_key) do update set
  category = excluded.category,
  title = excluded.title,
  objective = excluded.objective,
  expected_result = excluded.expected_result,
  required = excluded.required,
  sort_order = excluded.sort_order,
  updated_by = 'system-migration';

insert into public.uat_scenario_events (scenario_id, event_type, actor, after_snapshot, note)
select
  scenario.id,
  'created',
  'system-migration',
  jsonb_build_object(
    'status', scenario.status,
    'owner', scenario.owner,
    'environment', scenario.environment,
    'required', scenario.required
  ),
  'Skenario UAT Fase 9 disiapkan.'
from public.uat_scenarios scenario
where not exists (
  select 1 from public.uat_scenario_events event
  where event.scenario_id = scenario.id and event.event_type = 'created'
);

create or replace function public.update_uat_scenario(
  p_scenario_id uuid,
  p_actor text,
  p_status text,
  p_owner text,
  p_environment text,
  p_evidence_note text,
  p_evidence_url text,
  p_actual_result text,
  p_blocker_reason text
)
returns public.uat_scenarios
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  before_record public.uat_scenarios%rowtype;
  after_record public.uat_scenarios%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_owner text := nullif(lower(btrim(coalesce(p_owner, ''))), '');
  normalized_evidence text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  normalized_evidence_url text := nullif(btrim(coalesce(p_evidence_url, '')), '');
  normalized_actual text := nullif(btrim(coalesce(p_actual_result, '')), '');
  normalized_blocker text := nullif(btrim(coalesce(p_blocker_reason, '')), '');
  next_event_type text;
begin
  if p_scenario_id is null then
    raise exception 'UAT_SCENARIO_ID_REQUIRED' using errcode = '22023';
  end if;
  if length(normalized_actor) < 3 then
    raise exception 'UAT_ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_status not in ('not_started', 'in_progress', 'passed', 'failed', 'blocked', 'not_applicable') then
    raise exception 'UAT_STATUS_INVALID' using errcode = '22023';
  end if;
  if p_environment not in ('local', 'staging', 'production') then
    raise exception 'UAT_ENVIRONMENT_INVALID' using errcode = '22023';
  end if;
  if p_status in ('in_progress', 'passed', 'failed', 'blocked') and normalized_owner is null then
    raise exception 'UAT_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_status in ('passed', 'failed')
    and (coalesce(length(normalized_evidence), 0) < 5 or coalesce(length(normalized_actual), 0) < 5) then
    raise exception 'UAT_EVIDENCE_REQUIRED' using errcode = '22023';
  end if;
  if p_status = 'blocked' and coalesce(length(normalized_blocker), 0) < 5 then
    raise exception 'UAT_BLOCKER_REQUIRED' using errcode = '22023';
  end if;
  if normalized_evidence_url is not null and normalized_evidence_url !~* '^https://[^[:space:]]+$' then
    raise exception 'UAT_EVIDENCE_URL_INVALID' using errcode = '22023';
  end if;

  select * into before_record
  from public.uat_scenarios
  where id = p_scenario_id
  for update;

  if before_record.id is null then
    raise exception 'UAT_SCENARIO_NOT_FOUND' using errcode = 'P0002';
  end if;
  if before_record.required and p_status = 'not_applicable' then
    raise exception 'UAT_REQUIRED_SCENARIO_CANNOT_SKIP' using errcode = '22023';
  end if;

  update public.uat_scenarios
  set status = p_status,
      owner = normalized_owner,
      environment = p_environment,
      evidence_note = normalized_evidence,
      evidence_url = normalized_evidence_url,
      actual_result = normalized_actual,
      blocker_reason = case when p_status = 'blocked' then normalized_blocker else null end,
      last_tested_at = case when p_status in ('passed', 'failed') then now() else last_tested_at end,
      last_tested_by = case when p_status in ('passed', 'failed') then normalized_actor else last_tested_by end,
      updated_by = normalized_actor
  where id = p_scenario_id
  returning * into after_record;

  next_event_type := case
    when before_record.status is distinct from after_record.status then 'status_changed'
    else 'evidence_updated'
  end;

  insert into public.uat_scenario_events (
    scenario_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    after_record.id,
    next_event_type,
    normalized_actor,
    jsonb_build_object(
      'status', before_record.status,
      'owner', before_record.owner,
      'environment', before_record.environment,
      'evidenceUrl', before_record.evidence_url
    ),
    jsonb_build_object(
      'status', after_record.status,
      'owner', after_record.owner,
      'environment', after_record.environment,
      'evidenceUrl', after_record.evidence_url
    ),
    case
      when after_record.status = 'blocked' then after_record.blocker_reason
      else after_record.evidence_note
    end
  );

  return after_record;
end;
$$;

revoke all on function public.update_uat_scenario(uuid,text,text,text,text,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.update_uat_scenario(uuid,text,text,text,text,text,text,text,text)
to service_role;

comment on table public.uat_scenarios is
  'Human-owned UAT scenarios and evidence. Passing all required rows only unlocks human pilot review.';
comment on table public.uat_scenario_events is
  'Immutable audit trail for Phase 9 UAT status and evidence changes.';
comment on function public.update_uat_scenario(uuid,text,text,text,text,text,text,text,text) is
  'Validates and audits UAT evidence. This function cannot activate any workflow.';

commit;
