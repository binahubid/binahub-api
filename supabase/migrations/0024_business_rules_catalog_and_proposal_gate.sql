-- Business Rules v0.1 mock, module-level catalog, and enforceable proposal gate.
-- Product names are solution umbrellas. Commercial prices belong to modules.

begin;

create table if not exists public.business_rule_sets (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  status text not null default 'draft',
  is_mock boolean not null default true,
  rules jsonb not null default '{}'::jsonb,
  effective_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_rule_sets_status_valid
    check (status in ('mock', 'draft', 'active', 'archived'))
);

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  product_key text not null unique,
  name text not null,
  status text not null default 'concept',
  objective text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_products_key_normalized
    check (product_key = lower(btrim(product_key)) and product_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  constraint catalog_products_status_valid
    check (status in ('concept', 'design', 'development', 'ready', 'retired'))
);

create table if not exists public.catalog_modules (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.catalog_products(id) on delete restrict,
  module_code text not null unique,
  name text not null,
  description text,
  standard_scope text,
  pricing_unit text not null,
  base_price numeric(14,2) not null default 0,
  currency text not null default 'IDR',
  readiness_status text not null default 'research',
  is_mock boolean not null default true,
  active boolean not null default true,
  catalog_version text not null default 'v0.1-mock',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_modules_code_normalized
    check (module_code = upper(btrim(module_code)) and module_code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  constraint catalog_modules_price_valid check (base_price >= 0),
  constraint catalog_modules_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint catalog_modules_readiness_valid
    check (readiness_status in ('research', 'design', 'development', 'testing', 'ready', 'retired'))
);

create index if not exists catalog_modules_product_idx
  on public.catalog_modules (product_id, active, readiness_status);
create index if not exists catalog_modules_version_idx
  on public.catalog_modules (catalog_version, is_mock);

alter table public.assessments
  add column if not exists proposal_draft_data jsonb,
  add column if not exists proposal_gate_status text not null default 'not_evaluated',
  add column if not exists proposal_gate_reasons jsonb not null default '[]'::jsonb,
  add column if not exists proposal_catalog_version text,
  add column if not exists proposal_generated_at timestamptz,
  add column if not exists proposal_approved_at timestamptz,
  add column if not exists proposal_approved_by text;

alter table public.assessments
  drop constraint if exists assessments_proposal_gate_status_valid;
alter table public.assessments
  add constraint assessments_proposal_gate_status_valid
  check (proposal_gate_status in (
    'not_evaluated', 'clear', 'pending_approval', 'approved', 'rejected', 'revision_required'
  )) not valid;

create index if not exists assessments_proposal_gate_queue_idx
  on public.assessments (proposal_gate_status, proposal_generated_at desc)
  where proposal_gate_status in ('pending_approval', 'revision_required');

create table if not exists public.proposal_approvals (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  status text not null default 'pending',
  reasons jsonb not null default '[]'::jsonb,
  assigned_to text,
  due_at timestamptz,
  requested_by text not null,
  decided_by text,
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposal_approvals_status_valid
    check (status in ('pending', 'approved', 'rejected', 'revision_required', 'cancelled'))
);

create unique index if not exists proposal_approvals_one_pending_idx
  on public.proposal_approvals (assessment_id)
  where status = 'pending';
create index if not exists proposal_approvals_queue_idx
  on public.proposal_approvals (status, due_at, created_at);

drop trigger if exists business_rule_sets_set_updated_at on public.business_rule_sets;
create trigger business_rule_sets_set_updated_at
before update on public.business_rule_sets
for each row execute function public.set_transformation_updated_at();

drop trigger if exists catalog_products_set_updated_at on public.catalog_products;
create trigger catalog_products_set_updated_at
before update on public.catalog_products
for each row execute function public.set_transformation_updated_at();

drop trigger if exists catalog_modules_set_updated_at on public.catalog_modules;
create trigger catalog_modules_set_updated_at
before update on public.catalog_modules
for each row execute function public.set_transformation_updated_at();

drop trigger if exists proposal_approvals_set_updated_at on public.proposal_approvals;
create trigger proposal_approvals_set_updated_at
before update on public.proposal_approvals
for each row execute function public.set_transformation_updated_at();

alter table public.business_rule_sets enable row level security;
alter table public.catalog_products enable row level security;
alter table public.catalog_modules enable row level security;
alter table public.proposal_approvals enable row level security;

revoke all on table public.business_rule_sets, public.catalog_products, public.catalog_modules, public.proposal_approvals
  from anon, authenticated;
grant select, insert, update on table public.business_rule_sets, public.catalog_products, public.catalog_modules, public.proposal_approvals
  to service_role;

insert into public.business_rule_sets (version, status, is_mock, rules)
values (
  'v0.1-mock',
  'mock',
  true,
  '{
    "currency": "IDR",
    "minimumTransaction": 25000000,
    "proposalValidityDays": 14,
    "humanGate": {
      "alwaysRequireApprovalForMock": true,
      "allowStandardAutoSend": false,
      "highDealThreshold": 150000000,
      "maxDiscountWithoutApproval": 5,
      "absoluteMaxDiscount": 10,
      "lowConfidenceThreshold": 0.75
    },
    "followUp": {
      "levels": [2, 7, 14],
      "maxMessages": 3,
      "timeZone": "Asia/Jakarta",
      "sendWindow": {"start": "09:00", "end": "16:00"}
    }
  }'::jsonb
)
on conflict (version) do update
set rules = excluded.rules,
    is_mock = true,
    status = case when business_rule_sets.status = 'active' then business_rule_sets.status else 'mock' end;

insert into public.catalog_products (product_key, name, status, notes)
values
  ('binainsight', 'BinaInsight', 'development', 'Assessment publik gratis; modul korporat disusun terpisah.'),
  ('binalab', 'BinaLab', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.'),
  ('binacoach', 'BinaCoach', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.'),
  ('binaplay', 'BinaPlay', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.'),
  ('binaacademy', 'BinaAcademy', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.'),
  ('binaworks', 'BinaWorks', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.'),
  ('binaimpact', 'BinaImpact', 'design', 'Payung solusi; harga tidak ditempelkan pada nama produk.')
on conflict (product_key) do nothing;

-- Only the public assessment is a known real module. Commercial rows below are
-- explicit mock placeholders and can never pass the proposal gate as ready data.
insert into public.catalog_modules (
  product_id, module_code, name, description, standard_scope, pricing_unit,
  base_price, readiness_status, is_mock, active, catalog_version
)
select product.id, seed.module_code, seed.name, seed.description, seed.standard_scope,
       seed.pricing_unit, seed.base_price, seed.readiness_status, seed.is_mock, true, 'v0.1-mock'
from (
  values
    ('binainsight', 'BI-PUBLIC', 'BinaInsight Public Assessment', 'Assessment publik gratis.', 'Assessment individual dan hasil PDF.', 'per responden', 0::numeric, 'ready', false),
    ('binainsight', 'BI-CORP-MOCK', '[MOCK] Diagnostic Korporat', 'Placeholder untuk desain modul korporat.', 'Akan diganti setelah katalog resmi tersedia.', 'per organisasi', 15000000::numeric, 'design', true),
    ('binalab', 'LAB-MOCK', '[MOCK] Modul BinaLab', 'Placeholder modul BinaLab.', 'Belum merupakan scope resmi.', 'per program', 35000000::numeric, 'design', true),
    ('binacoach', 'COACH-MOCK', '[MOCK] Modul BinaCoach', 'Placeholder modul BinaCoach.', 'Belum merupakan scope resmi.', 'per paket', 18000000::numeric, 'design', true),
    ('binaplay', 'PLAY-MOCK', '[MOCK] Modul BinaPlay', 'Placeholder modul BinaPlay.', 'Belum merupakan scope resmi.', 'per sesi', 45000000::numeric, 'design', true),
    ('binaacademy', 'ACADEMY-MOCK', '[MOCK] Modul BinaAcademy', 'Placeholder modul BinaAcademy.', 'Belum merupakan scope resmi.', 'per cohort', 120000000::numeric, 'design', true),
    ('binaworks', 'WORKS-MOCK', '[MOCK] Modul BinaWorks', 'Placeholder modul BinaWorks.', 'Belum merupakan scope resmi.', 'per sprint', 75000000::numeric, 'design', true),
    ('binaimpact', 'IMPACT-MOCK', '[MOCK] Modul BinaImpact', 'Placeholder modul BinaImpact.', 'Belum merupakan scope resmi.', 'per paket', 25000000::numeric, 'design', true)
) as seed(product_key, module_code, name, description, standard_scope, pricing_unit, base_price, readiness_status, is_mock)
join public.catalog_products product on product.product_key = seed.product_key
on conflict (module_code) do nothing;

commit;
