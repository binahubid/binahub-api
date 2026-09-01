-- Configurable catalog, commercial governance, risk SLA, legal templates,
-- and reusable pre-test/post-test modules per program.

begin;

alter table public.catalog_products
  add column if not exists slug text,
  add column if not exists short_description text,
  add column if not exists public_description text,
  add column if not exists cover_image_url text,
  add column if not exists public_visible boolean not null default false,
  add column if not exists featured boolean not null default false,
  add column if not exists display_order integer not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists created_by text,
  add column if not exists updated_by text;

update public.catalog_products
set slug = lower(regexp_replace(product_key, '_', '-', 'g'))
where slug is null or btrim(slug) = '';

with ranked_slugs as (
  select id, slug, row_number() over (partition by slug order by id) as occurrence
  from public.catalog_products
)
update public.catalog_products product
set slug = left(ranked.slug, 70) || '-' || left(replace(product.id::text, '-', ''), 8)
from ranked_slugs ranked
where product.id = ranked.id and ranked.occurrence > 1;

alter table public.catalog_products
  alter column slug set not null;

alter table public.catalog_products
  drop constraint if exists catalog_products_slug_normalized;
alter table public.catalog_products
  add constraint catalog_products_slug_normalized
  check (slug = lower(btrim(slug)) and slug ~ '^[a-z0-9][a-z0-9-]{1,79}$') not valid;

create unique index if not exists catalog_products_slug_unique_idx
  on public.catalog_products (slug);
create index if not exists catalog_products_public_idx
  on public.catalog_products (public_visible, featured desc, display_order, name)
  where public_visible;

alter table public.catalog_modules
  add column if not exists slug text,
  add column if not exists deliverables text,
  add column if not exists out_of_scope text,
  add column if not exists minimum_quantity numeric(12,2) not null default 1,
  add column if not exists duration_label text,
  add column if not exists public_visible boolean not null default false,
  add column if not exists featured boolean not null default false,
  add column if not exists display_order integer not null default 0,
  add column if not exists published_at timestamptz,
  add column if not exists created_by text,
  add column if not exists updated_by text;

update public.catalog_modules
set slug = lower(regexp_replace(module_code, '_', '-', 'g'))
where slug is null or btrim(slug) = '';

with ranked_slugs as (
  select id, slug, row_number() over (partition by slug order by id) as occurrence
  from public.catalog_modules
)
update public.catalog_modules module
set slug = left(ranked.slug, 90) || '-' || left(replace(module.id::text, '-', ''), 8)
from ranked_slugs ranked
where module.id = ranked.id and ranked.occurrence > 1;

alter table public.catalog_modules
  alter column slug set not null;

alter table public.catalog_modules
  drop constraint if exists catalog_modules_slug_normalized;
alter table public.catalog_modules
  add constraint catalog_modules_slug_normalized
  check (slug = lower(btrim(slug)) and slug ~ '^[a-z0-9][a-z0-9-]{1,99}$') not valid;
alter table public.catalog_modules
  drop constraint if exists catalog_modules_minimum_quantity_valid;
alter table public.catalog_modules
  add constraint catalog_modules_minimum_quantity_valid
  check (minimum_quantity > 0) not valid;

create unique index if not exists catalog_modules_slug_unique_idx
  on public.catalog_modules (slug);
create index if not exists catalog_modules_public_idx
  on public.catalog_modules (public_visible, featured desc, display_order, name)
  where public_visible and active;

create table if not exists public.commercial_policy_settings (
  setting_key text primary key default 'default',
  minimum_transaction_enabled boolean not null default true,
  minimum_transaction_amount numeric(14,2) not null default 15000000,
  below_threshold_action text not null default 'approval_required',
  route_catalog_module_id uuid references public.catalog_modules(id) on delete set null,
  currency text not null default 'IDR',
  proposal_validity_days integer not null default 14,
  allow_admin_override boolean not null default false,
  override_requires_note boolean not null default true,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_policy_setting_key_valid check (setting_key = 'default'),
  constraint commercial_policy_amount_valid check (minimum_transaction_amount >= 0),
  constraint commercial_policy_action_valid check (
    below_threshold_action in ('allow', 'reject', 'approval_required', 'route_to_module')
  ),
  constraint commercial_policy_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint commercial_policy_validity_valid check (proposal_validity_days between 1 and 365),
  constraint commercial_policy_route_valid check (
    below_threshold_action <> 'route_to_module' or route_catalog_module_id is not null
  )
);

insert into public.commercial_policy_settings (
  setting_key,
  minimum_transaction_enabled,
  minimum_transaction_amount,
  below_threshold_action,
  currency,
  proposal_validity_days,
  updated_by
)
values ('default', true, 15000000, 'approval_required', 'IDR', 14, 'migration:0039')
on conflict (setting_key) do nothing;

create table if not exists public.governance_assignments (
  function_key text primary key,
  label text not null,
  description text,
  owner_user_id uuid references public.profiles(id) on delete set null,
  owner_email text,
  backup_user_id uuid references public.profiles(id) on delete set null,
  backup_email text,
  escalation_channel text,
  notes text,
  active boolean not null default true,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint governance_assignment_function_valid check (
    function_key in (
      'sales_operations',
      'proposal_commercial',
      'delivery',
      'deliverability_email',
      'template_content',
      'product_catalog',
      'technical_monitoring'
    )
  )
);

insert into public.governance_assignments (
  function_key,
  label,
  description,
  owner_email,
  updated_by
)
values
  ('sales_operations', 'Sales Operations', 'Kualitas pipeline, assignment lead, next action, dan follow-up.', null, 'migration:0039'),
  ('proposal_commercial', 'Proposal & Commercial', 'Scope, harga, kelengkapan proposal, dan koordinasi approval.', null, 'migration:0039'),
  ('delivery', 'Delivery', 'Kesiapan tim, jadwal, risiko delivery, dan kesinambungan layanan.', null, 'migration:0039'),
  ('deliverability_email', 'Deliverability & Email', 'Bounce, suppression, domain health, dan insiden pengiriman email.', null, 'migration:0039'),
  ('template_content', 'Template & Content', 'Versi, tone, klaim, dan review template komunikasi.', 'admin@binahub.id', 'migration:0039'),
  ('product_catalog', 'Product Catalog', 'Kesiapan produk, modul, scope, deliverables, dan publikasi katalog.', null, 'migration:0039'),
  ('technical_monitoring', 'Technical & Monitoring', 'Kesehatan aplikasi, integrasi, workflow, alert, dan incident response.', 'admin@binahub.id', 'migration:0039')
on conflict (function_key) do nothing;

create table if not exists public.approval_delegations (
  approval_key text primary key,
  label text not null,
  description text,
  primary_approver_user_id uuid references public.profiles(id) on delete set null,
  primary_approver_email text,
  delegate_user_id uuid references public.profiles(id) on delete set null,
  delegate_email text,
  valid_from timestamptz,
  valid_until timestamptz,
  maximum_amount numeric(14,2),
  maximum_discount_percent numeric(5,2),
  conditions text,
  active boolean not null default false,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_delegation_key_valid check (
    approval_key in (
      'standard_proposal',
      'discount_exception',
      'below_minimum_transaction',
      'custom_scope',
      'legal_reputation_risk',
      'strategic_or_high_value_deal'
    )
  ),
  constraint approval_delegation_dates_valid check (
    valid_until is null or valid_from is null or valid_until > valid_from
  ),
  constraint approval_delegation_amount_valid check (
    maximum_amount is null or maximum_amount >= 0
  ),
  constraint approval_delegation_discount_valid check (
    maximum_discount_percent is null or maximum_discount_percent between 0 and 100
  )
);

insert into public.approval_delegations (approval_key, label, description, updated_by)
values
  ('standard_proposal', 'Proposal standar', 'Persetujuan proposal dengan modul dan scope standar.', 'migration:0039'),
  ('discount_exception', 'Pengecualian diskon', 'Persetujuan diskon yang melewati batas operasional.', 'migration:0039'),
  ('below_minimum_transaction', 'Transaksi di bawah minimum', 'Pengecualian nilai transaksi di bawah kebijakan minimum.', 'migration:0039'),
  ('custom_scope', 'Scope kustom', 'Perubahan scope, deliverables, atau komitmen di luar katalog standar.', 'migration:0039'),
  ('legal_reputation_risk', 'Risiko legal, reputasi, etik, dan konflik', 'Keputusan atas risiko yang dapat mengikat atau merugikan perusahaan.', 'migration:0039'),
  ('strategic_or_high_value_deal', 'Deal strategis atau bernilai tinggi', 'Keputusan untuk nilai atau komitmen strategis di atas batas kewenangan.', 'migration:0039')
on conflict (approval_key) do nothing;

create table if not exists public.risk_sla_policies (
  severity text primary key,
  label text not null,
  enabled boolean not null default false,
  acknowledgment_minutes integer not null,
  initial_review_minutes integer not null,
  backup_escalation_minutes integer not null,
  final_decision_minutes integer not null,
  business_hours_only boolean not null default true,
  time_zone text not null default 'Asia/Jakarta',
  escalation_channels jsonb not null default '["notification","email"]'::jsonb,
  owner_email text,
  notes text,
  version integer not null default 1,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint risk_sla_severity_valid check (severity in ('low', 'medium', 'high', 'critical')),
  constraint risk_sla_minutes_valid check (
    acknowledgment_minutes > 0
    and initial_review_minutes >= acknowledgment_minutes
    and backup_escalation_minutes >= initial_review_minutes
    and final_decision_minutes >= backup_escalation_minutes
  )
);

insert into public.risk_sla_policies (
  severity,
  label,
  enabled,
  acknowledgment_minutes,
  initial_review_minutes,
  backup_escalation_minutes,
  final_decision_minutes,
  updated_by
)
values
  ('low', 'Rendah', false, 480, 960, 1440, 2400, 'migration:0039'),
  ('medium', 'Menengah', false, 240, 480, 960, 1440, 'migration:0039'),
  ('high', 'Tinggi', false, 60, 240, 480, 960, 'migration:0039'),
  ('critical', 'Kritis', false, 15, 60, 120, 240, 'migration:0039')
on conflict (severity) do nothing;

create table if not exists public.document_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null,
  document_type text not null,
  name text not null,
  locale text not null default 'id',
  version text not null,
  status text not null default 'review',
  body_template text not null,
  variables jsonb not null default '[]'::jsonb,
  review_required boolean not null default true,
  owner_email text,
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_template_type_valid check (document_type in ('proposal', 'invoice')),
  constraint document_template_locale_valid check (locale in ('id', 'en')),
  constraint document_template_status_valid check (status in ('draft', 'review', 'approved', 'archived')),
  constraint document_template_approval_valid check (
    status <> 'approved'
    or (
      approved_by is not null
      and approved_at is not null
      and approval_note is not null
      and length(btrim(approval_note)) >= 5
    )
  ),
  unique (template_key, locale, version)
);

insert into public.document_templates (
  template_key,
  document_type,
  name,
  locale,
  version,
  status,
  body_template,
  variables,
  review_required,
  owner_email,
  created_by,
  updated_by
)
values
  (
    'proposal_finance_legal_clause',
    'proposal',
    'Klausul Pajak Proposal',
    'id',
    'v1.0-review',
    'review',
    'BinaHub saat ini belum dikukuhkan sebagai Pengusaha Kena Pajak (PKP), sehingga harga tidak mencantumkan pungutan PPN oleh BinaHub. Apabila pembayaran atas transaksi ini termasuk objek pemotongan PPh Pasal 23 dan pihak pelanggan berkewajiban melakukan pemotongan, pemotongan dilakukan sesuai ketentuan yang berlaku dan pelanggan wajib menyerahkan bukti potong yang sah kepada BinaHub.',
    '[]'::jsonb,
    true,
    'admin@binahub.id',
    'migration:0039',
    'migration:0039'
  ),
  (
    'invoice_finance_legal_clause',
    'invoice',
    'Klausul Pajak Invoice',
    'id',
    'v1.0-review',
    'review',
    'BinaHub saat ini belum dikukuhkan sebagai Pengusaha Kena Pajak (PKP), sehingga tagihan tidak mencantumkan pungutan PPN oleh BinaHub. Jika transaksi memenuhi ketentuan pemotongan PPh Pasal 23, mohon kirimkan bukti potong yang sah melalui kanal resmi BinaHub.',
    '[]'::jsonb,
    true,
    'admin@binahub.id',
    'migration:0039',
    'migration:0039'
  )
on conflict (template_key, locale, version) do nothing;

alter table public.program_modules
  drop constraint if exists program_modules_module_key_check;
alter table public.program_modules
  add constraint program_modules_module_key_check
  check (module_key in ('tbos', 'lep', 'binainsight', 'pre_test', 'post_test'));

create table if not exists public.program_questionnaires (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.engagements(id) on delete cascade,
  kind text not null,
  title text not null,
  description text,
  instructions text,
  status text not null default 'draft',
  passing_score numeric(5,2),
  allow_retake boolean not null default false,
  shuffle_questions boolean not null default false,
  source_filename text,
  source_type text,
  version integer not null default 1,
  published_at timestamptz,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_questionnaire_kind_valid check (kind in ('pre_test', 'post_test')),
  constraint program_questionnaire_status_valid check (status in ('draft', 'published', 'archived')),
  constraint program_questionnaire_passing_score_valid check (
    passing_score is null or passing_score between 0 and 100
  ),
  unique (program_id, kind)
);

create table if not exists public.program_questionnaire_questions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.program_questionnaires(id) on delete cascade,
  position integer not null,
  question_type text not null,
  prompt text not null,
  help_text text,
  required boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb,
  points numeric(8,2) not null default 1,
  scale_min integer,
  scale_max integer,
  scale_labels jsonb not null default '{}'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questionnaire_question_type_valid check (
    question_type in (
      'single_choice',
      'multiple_choice',
      'yes_no',
      'scale',
      'short_text',
      'long_text',
      'number'
    )
  ),
  constraint questionnaire_question_position_valid check (position > 0),
  constraint questionnaire_question_points_valid check (points >= 0),
  constraint questionnaire_question_scale_valid check (
    question_type <> 'scale'
    or (
      scale_min is not null
      and scale_max is not null
      and scale_min >= 0
      and scale_max > scale_min
      and scale_max - scale_min <= 20
    )
  ),
  unique (questionnaire_id, position)
);

create table if not exists public.program_questionnaire_submissions (
  id uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.program_questionnaires(id) on delete cascade,
  program_id uuid not null references public.engagements(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  attempt_number integer not null default 1,
  answers jsonb not null default '[]'::jsonb,
  score numeric(10,2),
  maximum_score numeric(10,2),
  percentage numeric(5,2),
  status text not null default 'submitted',
  submitted_by text,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint questionnaire_submission_attempt_valid check (attempt_number > 0),
  constraint questionnaire_submission_status_valid check (status in ('submitted', 'invalidated')),
  constraint questionnaire_submission_percentage_valid check (
    percentage is null or percentage between 0 and 100
  ),
  unique (questionnaire_id, profile_id, attempt_number)
);

create index if not exists program_questionnaires_program_idx
  on public.program_questionnaires (program_id, kind, status);
create index if not exists questionnaire_questions_order_idx
  on public.program_questionnaire_questions (questionnaire_id, position);
create index if not exists questionnaire_submissions_stats_idx
  on public.program_questionnaire_submissions (questionnaire_id, status, submitted_at desc);
create index if not exists questionnaire_submissions_participant_idx
  on public.program_questionnaire_submissions (program_id, participant_id, submitted_at desc);

create or replace function public.replace_program_questionnaire_questions(
  p_questionnaire_id uuid,
  p_questions jsonb,
  p_source_filename text default null,
  p_source_type text default null,
  p_actor text default null
)
returns setof public.program_questionnaire_questions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.program_questionnaires where id = p_questionnaire_id
  ) then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then
    raise exception 'QUESTION_LIST_EMPTY';
  end if;
  if exists (
    select 1
    from public.program_questionnaire_submissions
    where questionnaire_id = p_questionnaire_id
  ) then
    raise exception 'QUESTIONNAIRE_HAS_SUBMISSIONS';
  end if;

  delete from public.program_questionnaire_questions
  where questionnaire_id = p_questionnaire_id;

  insert into public.program_questionnaire_questions (
    questionnaire_id,
    position,
    question_type,
    prompt,
    help_text,
    required,
    options,
    correct_answer,
    points,
    scale_min,
    scale_max,
    scale_labels,
    created_by,
    updated_by
  )
  select
    p_questionnaire_id,
    (item->>'position')::integer,
    item->>'questionType',
    item->>'prompt',
    nullif(item->>'helpText', ''),
    coalesce((item->>'required')::boolean, true),
    coalesce(item->'options', '[]'::jsonb),
    case
      when item->'correctAnswer' is null or jsonb_typeof(item->'correctAnswer') = 'null' then null
      else item->'correctAnswer'
    end,
    coalesce((item->>'points')::numeric, 1),
    nullif(item->>'scaleMin', '')::integer,
    nullif(item->>'scaleMax', '')::integer,
    coalesce(item->'scaleLabels', '{}'::jsonb),
    p_actor,
    p_actor
  from jsonb_array_elements(p_questions) item;

  update public.program_questionnaires
  set
    status = 'draft',
    published_at = null,
    source_filename = p_source_filename,
    source_type = p_source_type,
    version = version + 1,
    updated_by = p_actor
  where id = p_questionnaire_id;

  return query
  select *
  from public.program_questionnaire_questions
  where questionnaire_id = p_questionnaire_id
  order by position;
end;
$$;

revoke all on function public.replace_program_questionnaire_questions(uuid, jsonb, text, text, text)
from public, anon, authenticated;
grant execute on function public.replace_program_questionnaire_questions(uuid, jsonb, text, text, text)
to service_role;

drop trigger if exists commercial_policy_settings_set_updated_at on public.commercial_policy_settings;
create trigger commercial_policy_settings_set_updated_at
before update on public.commercial_policy_settings
for each row execute function public.set_transformation_updated_at();

drop trigger if exists governance_assignments_set_updated_at on public.governance_assignments;
create trigger governance_assignments_set_updated_at
before update on public.governance_assignments
for each row execute function public.set_transformation_updated_at();

drop trigger if exists approval_delegations_set_updated_at on public.approval_delegations;
create trigger approval_delegations_set_updated_at
before update on public.approval_delegations
for each row execute function public.set_transformation_updated_at();

drop trigger if exists risk_sla_policies_set_updated_at on public.risk_sla_policies;
create trigger risk_sla_policies_set_updated_at
before update on public.risk_sla_policies
for each row execute function public.set_transformation_updated_at();

drop trigger if exists document_templates_set_updated_at on public.document_templates;
create trigger document_templates_set_updated_at
before update on public.document_templates
for each row execute function public.set_transformation_updated_at();

drop trigger if exists program_questionnaires_set_updated_at on public.program_questionnaires;
create trigger program_questionnaires_set_updated_at
before update on public.program_questionnaires
for each row execute function public.set_transformation_updated_at();

drop trigger if exists program_questionnaire_questions_set_updated_at on public.program_questionnaire_questions;
create trigger program_questionnaire_questions_set_updated_at
before update on public.program_questionnaire_questions
for each row execute function public.set_transformation_updated_at();

alter table public.commercial_policy_settings enable row level security;
alter table public.governance_assignments enable row level security;
alter table public.approval_delegations enable row level security;
alter table public.risk_sla_policies enable row level security;
alter table public.document_templates enable row level security;
alter table public.program_questionnaires enable row level security;
alter table public.program_questionnaire_questions enable row level security;
alter table public.program_questionnaire_submissions enable row level security;

revoke all on table
  public.commercial_policy_settings,
  public.governance_assignments,
  public.approval_delegations,
  public.risk_sla_policies,
  public.document_templates,
  public.program_questionnaires,
  public.program_questionnaire_questions,
  public.program_questionnaire_submissions
from anon, authenticated;

grant select, insert, update, delete on table
  public.commercial_policy_settings,
  public.governance_assignments,
  public.approval_delegations,
  public.risk_sla_policies,
  public.document_templates,
  public.program_questionnaires,
  public.program_questionnaire_questions,
  public.program_questionnaire_submissions
to service_role;

commit;
