-- Phase 2 sales operations: auditable opportunity pipeline, approved outreach
-- templates, and idempotent email-deliverability events.

begin;

alter table public.leads
  add column if not exists industry text,
  add column if not exists location text,
  add column if not exists qualification_profile jsonb not null default '{}'::jsonb,
  add column if not exists opportunity_owner text,
  add column if not exists next_action text,
  add column if not exists next_action_due_at timestamptz,
  add column if not exists lead_time_zone text,
  add column if not exists opportunity_value numeric(14,2),
  add column if not exists lost_reason text,
  add column if not exists won_at timestamptz,
  add column if not exists lost_at timestamptz,
  add column if not exists outreach_paused boolean not null default false,
  add column if not exists outreach_pause_reason text,
  add column if not exists outreach_paused_at timestamptz,
  add column if not exists outreach_paused_by text,
  add column if not exists pipeline_updated_at timestamptz not null default now();

alter table public.leads
  drop constraint if exists leads_opportunity_value_valid;
alter table public.leads
  add constraint leads_opportunity_value_valid
  check (opportunity_value is null or opportunity_value >= 0) not valid;

alter table public.leads
  drop constraint if exists leads_time_zone_valid;
alter table public.leads
  add constraint leads_time_zone_valid
  check (lead_time_zone is null or length(btrim(lead_time_zone)) between 3 and 80) not valid;

alter table public.leads
  drop constraint if exists leads_industry_valid;
alter table public.leads
  add constraint leads_industry_valid
  check (industry is null or length(btrim(industry)) between 2 and 200) not valid;

alter table public.leads
  drop constraint if exists leads_location_valid;
alter table public.leads
  add constraint leads_location_valid
  check (location is null or length(btrim(location)) between 2 and 300) not valid;

create index if not exists leads_pipeline_owner_due_idx
  on public.leads (opportunity_owner, next_action_due_at)
  where opportunity_stage not in ('won', 'lost');
create index if not exists leads_pipeline_stage_updated_idx
  on public.leads (opportunity_stage, pipeline_updated_at desc);
create index if not exists leads_outreach_paused_idx
  on public.leads (outreach_paused, outreach_paused_at desc)
  where outreach_paused;

create table if not exists public.opportunity_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  assessment_id uuid references public.assessments(id) on delete set null,
  inquiry_id uuid references public.inquiries(id) on delete set null,
  event_type text not null,
  from_stage text,
  to_stage text,
  actor text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint opportunity_activities_event_type_valid
    check (event_type ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint opportunity_activities_actor_valid
    check (length(btrim(actor)) between 3 and 320),
  constraint opportunity_activities_stage_valid
    check (
      (from_stage is null or from_stage in ('identified', 'qualified', 'consultation', 'proposal', 'negotiation', 'won', 'lost'))
      and (to_stage is null or to_stage in ('identified', 'qualified', 'consultation', 'proposal', 'negotiation', 'won', 'lost'))
    )
);

create index if not exists opportunity_activities_lead_created_idx
  on public.opportunity_activities (lead_id, created_at desc);
create index if not exists opportunity_activities_event_created_idx
  on public.opportunity_activities (event_type, created_at desc);

create table if not exists public.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  locale text not null default 'id',
  version text not null,
  status text not null default 'draft',
  subject_template text not null,
  html_template text not null,
  owner text,
  is_mock boolean not null default false,
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outreach_templates_key_valid
    check (template_key ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint outreach_templates_locale_valid check (locale in ('id', 'en')),
  constraint outreach_templates_status_valid check (status in ('draft', 'approved', 'archived')),
  constraint outreach_templates_version_valid check (length(btrim(version)) between 1 and 40),
  constraint outreach_templates_subject_valid check (length(btrim(subject_template)) between 1 and 300),
  constraint outreach_templates_body_valid check (length(btrim(html_template)) between 10 and 30000),
  constraint outreach_templates_approval_complete check (
    status <> 'approved'
    or (
      is_mock = false
      and approved_by is not null
      and approved_at is not null
      and approval_note is not null
      and length(btrim(approval_note)) >= 5
    )
  ),
  constraint outreach_templates_version_unique unique (template_key, locale, version)
);

create unique index if not exists outreach_templates_one_approved_idx
  on public.outreach_templates (template_key, locale)
  where status = 'approved';
create index if not exists outreach_templates_status_idx
  on public.outreach_templates (status, template_key, locale, updated_at desc);

insert into public.outreach_templates (
  template_key, locale, version, status, subject_template, html_template, owner, is_mock, created_by
) values
  ('inquiry_follow_up_1', 'id', 'mock-v1', 'draft', 'Menindaklanjuti kebutuhan {{company}}', '<p>Halo {{name}}, kami memastikan kebutuhan yang Anda kirimkan sudah diterima. Silakan balas email ini jika ada konteks tambahan yang perlu kami pahami.</p>', null, true, 'system-migration'),
  ('inquiry_follow_up_2', 'id', 'mock-v1', 'draft', 'Apakah kebutuhan {{company}} masih perlu dibahas?', '<p>Halo {{name}}, kami menindaklanjuti kebutuhan {{company}}. Jika masih relevan, kami dapat membantu merapikan ruang lingkup dan langkah berikutnya.</p>', null, true, 'system-migration'),
  ('inquiry_follow_up_3', 'id', 'mock-v1', 'draft', 'Konfirmasi tindak lanjut untuk {{company}}', '<p>Halo {{name}}, ini konfirmasi terakhir dari rangkaian tindak lanjut kami. Balas email ini bila pembahasan ingin dilanjutkan; jika belum, kami akan menutup antrean sementara.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_1', 'id', 'mock-v1', 'draft', 'Tindak lanjut hasil BinaInsight {{company}}', '<p>Halo {{name}}, apakah laporan BinaInsight untuk {{company}} sudah dapat ditinjau? Kami siap membantu menjelaskan prioritas yang paling relevan.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_2', 'id', 'mock-v1', 'draft', 'Diskusi prioritas hasil BinaInsight {{company}}', '<p>Halo {{name}}, hasil assessment dapat digunakan sebagai dasar memilih prioritas intervensi. Balas email ini jika Anda ingin membahas temuan utama bersama tim kami.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_3', 'id', 'mock-v1', 'draft', 'Konfirmasi pembahasan hasil BinaInsight', '<p>Halo {{name}}, kami akan menjeda tindak lanjut hasil assessment setelah email ini. Jika {{company}} ingin melanjutkan, balas email ini dan kami akan menyiapkan langkah berikutnya.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_1', 'id', 'mock-v1', 'draft', 'Tindak lanjut proposal {{company}}', '<p>Halo {{name}}, kami memastikan proposal awal untuk {{company}} sudah diterima. Silakan sampaikan pertanyaan atau bagian yang perlu disesuaikan.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_2', 'id', 'mock-v1', 'draft', 'Pembahasan lanjutan proposal {{company}}', '<p>Halo {{name}}, kami dapat membantu mengklarifikasi ruang lingkup, jadwal, dan asumsi komersial pada proposal. Balas email ini untuk menentukan langkah berikutnya.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_3', 'id', 'mock-v1', 'draft', 'Konfirmasi keputusan proposal {{company}}', '<p>Halo {{name}}, ini tindak lanjut terakhir untuk proposal {{company}}. Mohon informasikan apakah pembahasan dilanjutkan, ditunda, atau ditutup agar statusnya jelas.</p>', null, true, 'system-migration')
on conflict (template_key, locale, version) do nothing;

insert into public.outreach_templates (
  template_key, locale, version, status, subject_template, html_template, owner, is_mock, created_by
) values
  ('inquiry_follow_up_1', 'en', 'mock-v1', 'draft', 'Following up on {{company}} needs', '<p>Hello {{name}}, we are confirming that your message has been received. Reply to this email if there is any additional context we should understand.</p>', null, true, 'system-migration'),
  ('inquiry_follow_up_2', 'en', 'mock-v1', 'draft', 'Does {{company}} still need to discuss this?', '<p>Hello {{name}}, we are following up on the needs shared by {{company}}. If they are still relevant, we can help clarify the scope and next step.</p>', null, true, 'system-migration'),
  ('inquiry_follow_up_3', 'en', 'mock-v1', 'draft', 'Confirming next steps for {{company}}', '<p>Hello {{name}}, this is the final message in our follow-up sequence. Reply if you would like to continue; otherwise, we will close the queue for now.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_1', 'en', 'mock-v1', 'draft', 'Following up on the BinaInsight result for {{company}}', '<p>Hello {{name}}, have you had a chance to review the BinaInsight report for {{company}}? We can help clarify the most relevant priorities.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_2', 'en', 'mock-v1', 'draft', 'Discussing BinaInsight priorities for {{company}}', '<p>Hello {{name}}, the assessment result can help frame intervention priorities. Reply if you would like to discuss the key findings with our team.</p>', null, true, 'system-migration'),
  ('assessment_result_follow_up_3', 'en', 'mock-v1', 'draft', 'Confirming the BinaInsight result discussion', '<p>Hello {{name}}, we will pause follow-up after this email. If {{company}} would like to continue, reply and we will prepare the next step.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_1', 'en', 'mock-v1', 'draft', 'Following up on the proposal for {{company}}', '<p>Hello {{name}}, we are confirming that the initial proposal for {{company}} was received. Please share any questions or sections that need adjustment.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_2', 'en', 'mock-v1', 'draft', 'Continuing the proposal discussion for {{company}}', '<p>Hello {{name}}, we can clarify the scope, timeline, and commercial assumptions in the proposal. Reply to determine the next step.</p>', null, true, 'system-migration'),
  ('assessment_proposal_follow_up_3', 'en', 'mock-v1', 'draft', 'Confirming the proposal decision for {{company}}', '<p>Hello {{name}}, this is the final follow-up for the {{company}} proposal. Please let us know whether the discussion should continue, pause, or close.</p>', null, true, 'system-migration')
on conflict (template_key, locale, version) do nothing;

drop trigger if exists outreach_templates_set_updated_at on public.outreach_templates;
create trigger outreach_templates_set_updated_at
before update on public.outreach_templates
for each row execute function public.set_transformation_updated_at();

create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'resend',
  webhook_id text not null,
  email_id text,
  event_type text not null,
  recipient_email text,
  sender_email text,
  subject text,
  tags jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  processing_status text not null default 'received',
  error_message text,
  provider_created_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint email_delivery_events_provider_valid check (provider in ('resend')),
  constraint email_delivery_events_status_valid check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  constraint email_delivery_events_webhook_unique unique (provider, webhook_id)
);

create index if not exists email_delivery_events_type_created_idx
  on public.email_delivery_events (event_type, received_at desc);
create index if not exists email_delivery_events_recipient_idx
  on public.email_delivery_events (recipient_email, received_at desc)
  where recipient_email is not null;
create index if not exists email_delivery_events_processing_idx
  on public.email_delivery_events (processing_status, received_at desc)
  where processing_status in ('received', 'failed');

alter table public.opportunity_activities enable row level security;
alter table public.outreach_templates enable row level security;
alter table public.email_delivery_events enable row level security;

revoke all on table public.opportunity_activities, public.outreach_templates, public.email_delivery_events
  from anon, authenticated;
grant select, insert, update on table public.opportunity_activities, public.outreach_templates, public.email_delivery_events
  to service_role;
grant delete on table public.outreach_templates to service_role;

create or replace function public.update_sales_opportunity(
  p_lead_id uuid,
  p_stage text,
  p_actor text,
  p_owner text default null,
  p_next_action text default null,
  p_next_action_due_at timestamptz default null,
  p_note text default null,
  p_lost_reason text default null,
  p_opportunity_value numeric default null,
  p_lead_time_zone text default null,
  p_outreach_paused boolean default null,
  p_outreach_pause_reason text default null
)
returns public.leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead public.leads%rowtype;
  updated_lead public.leads%rowtype;
  should_pause boolean;
begin
  if p_stage not in ('identified', 'qualified', 'consultation', 'proposal', 'negotiation', 'won', 'lost') then
    raise exception 'INVALID_OPPORTUNITY_STAGE' using errcode = '22023';
  end if;
  if p_actor is null or length(btrim(p_actor)) < 3 then
    raise exception 'ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_stage = 'lost' and (p_lost_reason is null or length(btrim(p_lost_reason)) < 5) then
    raise exception 'LOST_REASON_REQUIRED' using errcode = '22023';
  end if;
  if p_stage <> 'identified' and (p_owner is null or length(btrim(p_owner)) < 3) then
    raise exception 'OPPORTUNITY_OWNER_REQUIRED' using errcode = '22023';
  end if;
  if p_stage in ('qualified', 'consultation', 'proposal', 'negotiation')
    and (p_next_action is null or length(btrim(p_next_action)) < 3) then
    raise exception 'NEXT_ACTION_REQUIRED' using errcode = '22023';
  end if;
  if p_stage in ('qualified', 'consultation', 'proposal', 'negotiation') and p_next_action_due_at is null then
    raise exception 'NEXT_ACTION_DUE_AT_REQUIRED' using errcode = '22023';
  end if;
  if p_opportunity_value is not null and p_opportunity_value < 0 then
    raise exception 'INVALID_OPPORTUNITY_VALUE' using errcode = '22023';
  end if;

  select * into current_lead
  from public.leads
  where id = p_lead_id
  for update;
  if not found then
    raise exception 'LEAD_NOT_FOUND' using errcode = 'P0002';
  end if;

  should_pause := coalesce(
    p_outreach_paused,
    case
      when p_stage in ('consultation', 'negotiation', 'won', 'lost') then true
      else current_lead.outreach_paused
    end
  );

  update public.leads
  set opportunity_stage = p_stage,
      lifecycle_stage = case
        when p_stage = 'won' then 'client'
        when lifecycle_stage = 'prospect' and p_stage <> 'identified' then 'lead'
        else lifecycle_stage
      end,
      opportunity_owner = nullif(btrim(p_owner), ''),
      next_action = case when p_stage in ('won', 'lost') then null else nullif(btrim(p_next_action), '') end,
      next_action_due_at = case when p_stage in ('won', 'lost') then null else p_next_action_due_at end,
      lost_reason = case when p_stage = 'lost' then btrim(p_lost_reason) else null end,
      won_at = case when p_stage = 'won' then coalesce(won_at, now()) else null end,
      lost_at = case when p_stage = 'lost' then coalesce(lost_at, now()) else null end,
      opportunity_value = p_opportunity_value,
      lead_time_zone = coalesce(nullif(btrim(p_lead_time_zone), ''), lead_time_zone),
      outreach_paused = should_pause,
      outreach_pause_reason = case
        when should_pause then coalesce(nullif(btrim(p_outreach_pause_reason), ''), 'human_or_stage_control')
        else null
      end,
      outreach_paused_at = case when should_pause then coalesce(outreach_paused_at, now()) else null end,
      outreach_paused_by = case when should_pause then btrim(p_actor) else null end,
      last_meaningful_activity_at = now(),
      pipeline_updated_at = now()
  where id = p_lead_id
  returning * into updated_lead;

  update public.assessments
  set follow_up_paused = should_pause
  where lead_id = p_lead_id;

  update public.inquiries
  set follow_up_paused = should_pause
  where lead_id = p_lead_id;

  insert into public.opportunity_activities (
    lead_id, event_type, from_stage, to_stage, actor, note, metadata
  ) values (
    p_lead_id,
    case when current_lead.opportunity_stage is distinct from p_stage then 'stage_changed' else 'opportunity_updated' end,
    current_lead.opportunity_stage,
    p_stage,
    btrim(p_actor),
    nullif(btrim(p_note), ''),
    jsonb_build_object(
      'before', jsonb_build_object(
        'owner', current_lead.opportunity_owner,
        'nextAction', current_lead.next_action,
        'nextActionDueAt', current_lead.next_action_due_at,
        'outreachPaused', current_lead.outreach_paused
      ),
      'after', jsonb_build_object(
        'owner', updated_lead.opportunity_owner,
        'nextAction', updated_lead.next_action,
        'nextActionDueAt', updated_lead.next_action_due_at,
        'outreachPaused', updated_lead.outreach_paused,
        'opportunityValue', updated_lead.opportunity_value
      )
    )
  );

  return updated_lead;
end;
$$;

revoke all on function public.update_sales_opportunity(uuid,text,text,text,text,timestamptz,text,text,numeric,text,boolean,text)
  from public, anon, authenticated;
grant execute on function public.update_sales_opportunity(uuid,text,text,text,text,timestamptz,text,text,numeric,text,boolean,text)
  to service_role;

comment on function public.update_sales_opportunity(uuid,text,text,text,text,timestamptz,text,text,numeric,text,boolean,text) is
  'Atomically updates an opportunity, synchronizes outreach pause state, and records an immutable audit activity.';

create or replace function public.save_outreach_template(
  p_id uuid,
  p_template_key text,
  p_locale text,
  p_version text,
  p_status text,
  p_subject_template text,
  p_html_template text,
  p_owner text,
  p_is_mock boolean,
  p_actor text,
  p_approval_note text
)
returns public.outreach_templates
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  saved_template public.outreach_templates%rowtype;
begin
  if p_actor is null or length(btrim(p_actor)) < 3 then
    raise exception 'ACTOR_REQUIRED' using errcode = '22023';
  end if;
  if p_status = 'approved' and p_is_mock then
    raise exception 'MOCK_TEMPLATE_CANNOT_BE_APPROVED' using errcode = '22023';
  end if;
  if p_status = 'approved' and (p_approval_note is null or length(btrim(p_approval_note)) < 5) then
    raise exception 'APPROVAL_NOTE_REQUIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_template_key || ':' || p_locale, 0));
  if p_status = 'approved' then
    update public.outreach_templates
    set status = 'archived', updated_at = now()
    where template_key = p_template_key
      and locale = p_locale
      and status = 'approved'
      and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.outreach_templates (
      template_key, locale, version, status, subject_template, html_template,
      owner, is_mock, approved_by, approved_at, approval_note, created_by
    ) values (
      p_template_key, p_locale, p_version, p_status, p_subject_template, p_html_template,
      nullif(btrim(p_owner), ''), p_is_mock,
      case when p_status = 'approved' then btrim(p_actor) else null end,
      case when p_status = 'approved' then now() else null end,
      case when p_status = 'approved' then nullif(btrim(p_approval_note), '') else null end,
      btrim(p_actor)
    ) returning * into saved_template;
  else
    update public.outreach_templates
    set template_key = p_template_key,
        locale = p_locale,
        version = p_version,
        status = p_status,
        subject_template = p_subject_template,
        html_template = p_html_template,
        owner = nullif(btrim(p_owner), ''),
        is_mock = p_is_mock,
        approved_by = case when p_status = 'approved' then btrim(p_actor) else null end,
        approved_at = case when p_status = 'approved' then now() else null end,
        approval_note = case when p_status = 'approved' then nullif(btrim(p_approval_note), '') else null end,
        updated_at = now()
    where id = p_id
    returning * into saved_template;
    if not found then
      raise exception 'OUTREACH_TEMPLATE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  return saved_template;
end;
$$;

revoke all on function public.save_outreach_template(uuid,text,text,text,text,text,text,text,boolean,text,text)
  from public, anon, authenticated;
grant execute on function public.save_outreach_template(uuid,text,text,text,text,text,text,text,boolean,text,text)
  to service_role;

comment on function public.save_outreach_template(uuid,text,text,text,text,text,text,text,boolean,text,text) is
  'Atomically archives the previous approved version and saves one governed outreach template.';

commit;
