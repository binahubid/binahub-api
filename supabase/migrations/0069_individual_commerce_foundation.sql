-- Individual commerce preparation. No checkout, charge, grant or activation is installed.
-- Run after SQL 67/68 in the API database. Never imports a private question source.
begin;
do $$ begin
  if to_regclass('public.pe_guest_contacts') is null then raise exception 'PE_SQL67_REQUIRED'; end if;
  if not exists(select 1 from public.pe_instrument_versions
    where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1') then
    raise exception 'PE_PRIVATE_SOURCE_REQUIRED';
  end if;
end; $$;

create table if not exists public.pe_commerce_offer_revisions (
  id uuid primary key default gen_random_uuid(),
  revision int not null unique check(revision>=0),
  instrument_id text not null,
  instrument_version text not null,
  area_codes text[] not null check(cardinality(area_codes)=3),
  configuration jsonb not null check(jsonb_typeof(configuration)='object'),
  created_by uuid,
  created_at timestamptz not null default now(),
  foreign key(instrument_id,instrument_version) references public.pe_instrument_versions(instrument_id,version)
);
create table if not exists public.pe_commerce_settings (
  id boolean primary key default true check(id),
  revision int not null default 0 check(revision>=0),
  offer_id uuid not null references public.pe_commerce_offer_revisions,
  accepting_orders boolean not null default false check(not accepting_orders)
);
create table if not exists public.pe_commerce_customers (
  id uuid primary key default gen_random_uuid(),
  email text not null check(length(email) between 3 and 254 and email=lower(btrim(email))),
  verified_at timestamptz not null,
  created_at timestamptz not null default now()
  -- No auto-merge by email. Future scoped identity proofs must authorize linkage.
);
create table if not exists public.pe_commerce_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.pe_commerce_customers,
  offer_id uuid not null references public.pe_commerce_offer_revisions,
  total_idr bigint not null check(total_idr>0 and total_idr<=1000000000),
  currency text not null default 'IDR' check(currency='IDR'),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'),
  status text not null default 'awaiting_payment' check(status in ('awaiting_payment','paid','cancelled','refund_pending','partially_refunded','refunded','disputed')),
  idempotency_key text not null check(idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique(customer_id,idempotency_key), unique(id,customer_id)
);
create index if not exists pe_commerce_orders_created_idx on public.pe_commerce_orders(created_at desc,id desc);
create table if not exists public.pe_commerce_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pe_commerce_orders,
  provider text not null check(length(provider) between 1 and 64),
  environment text not null check(environment in ('sandbox','production')),
  merchant_reference text not null check(length(merchant_reference) between 1 and 200),
  provider_reference text not null check(length(provider_reference) between 1 and 200),
  status text not null check(status in ('creating','pending','unknown','succeeded','failed','expired','cancelled')),
  expires_at timestamptz,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(provider,environment,merchant_reference,provider_reference)
);
create table if not exists public.pe_commerce_entitlements (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique,
  customer_id uuid not null,
  area_codes text[] not null check(cardinality(area_codes)=3),
  status text not null check(status in ('available','in_progress','completed','expired','suspended','revoked')),
  attempts_allowed int not null check(attempts_allowed between 1 and 20),
  start_until timestamptz not null,
  complete_until timestamptz not null check(complete_until>=start_until),
  created_at timestamptz not null default now(),
  foreign key(order_id,customer_id) references public.pe_commerce_orders(id,customer_id)
);
create table if not exists public.pe_commerce_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_attempt_id uuid not null references public.pe_commerce_payment_attempts,
  event_key text not null check(length(event_key) between 1 and 200),
  verified_at timestamptz not null,
  received_at timestamptz not null default now(),
  unique(payment_attempt_id,event_key)
);
create table if not exists public.pe_commerce_outbox (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.pe_commerce_orders,
  kind text not null check(kind in ('payment_receipt','assessment_access')),
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','uncertain')),
  created_at timestamptz not null default now(),
  unique(order_id,kind)
);
create table if not exists public.pe_commerce_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  offer_id uuid not null references public.pe_commerce_offer_revisions,
  action text not null check(action='draft_saved'),
  created_at timestamptz not null default now()
);

-- Append-only revisions: an uncertain save can be replayed without creating another revision.
do $$ declare codes text[]; offer uuid; begin
  if not exists(select 1 from public.pe_commerce_settings) then
    select array_agg(value->>'code' order by value->>'code') into codes
    from public.pe_instrument_versions, jsonb_array_elements(manifest->'config'->'competencies')
    where instrument_id='BINAINSIGHTS-PE-V1' and version='1.0.0-draft.1'
      and value->>'code' not in ('PE-02','PE-04','PE-06');
    if cardinality(codes) is distinct from 3 then raise exception 'PE_COMMERCE_INSTRUMENT_MISMATCH'; end if;
    insert into public.pe_commerce_offer_revisions(revision,instrument_id,instrument_version,area_codes,configuration)
      values(0,'BINAINSIGHTS-PE-V1','1.0.0-draft.1',codes,
        '{"name":null,"description":null,"priceIdr":null,"attempts":null,"startWithinDays":null,"completeWithinDays":null,"retentionMonths":null,"refundPolicy":null,"terms":null,"reportVersion":null}') returning id into offer;
    insert into public.pe_commerce_settings(id,offer_id) values(true,offer);
  end if;
end; $$;

create or replace function public.pe_commerce_save_draft(p_revision int,p_configuration jsonb,p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.pe_commerce_settings; old public.pe_commerce_offer_revisions; v_id uuid; pair record; n numeric;
begin
  if p_actor is null or p_revision is null or p_revision<0 or p_configuration is null
    or jsonb_typeof(p_configuration)<>'object' then raise exception 'PE_INVALID_REQUEST'; end if;
  if (select count(*) from jsonb_object_keys(p_configuration))<>10
    or not(p_configuration ?& array['name','description','priceIdr','attempts','startWithinDays','completeWithinDays','retentionMonths','refundPolicy','terms','reportVersion']) then
    raise exception 'PE_INVALID_REQUEST';
  end if;
  for pair in select * from jsonb_each(p_configuration) loop
    if pair.value='null'::jsonb then continue; end if;
    if pair.key in ('name','description','refundPolicy','terms','reportVersion') then
      if jsonb_typeof(pair.value)<>'string' or length(btrim(pair.value#>>'{}'))=0
        or length(pair.value#>>'{}')>(case pair.key when 'name' then 160 when 'reportVersion' then 100 when 'description' then 1200 else 4000 end) then
        raise exception 'PE_INVALID_REQUEST';
      end if;
    else
      if jsonb_typeof(pair.value)<>'number' then raise exception 'PE_INVALID_REQUEST'; end if;
      n:=(pair.value#>>'{}')::numeric;
      if n<>trunc(n) or n<1 or n>(case pair.key when 'priceIdr' then 1000000000 when 'attempts' then 20 when 'retentionMonths' then 120 else 3650 end) then
        raise exception 'PE_INVALID_REQUEST';
      end if;
    end if;
  end loop;
  select * into s from public.pe_commerce_settings where id for update;
  if not found then raise exception 'PE_COMMERCE_SETUP_REQUIRED'; end if;
  select * into strict old from public.pe_commerce_offer_revisions where id=s.offer_id;
  if s.revision=p_revision+1 and old.created_by=p_actor and old.configuration=p_configuration then
    return jsonb_build_object('revision',s.revision); -- lost response, same authenticated save
  end if;
  if s.revision<>p_revision then raise exception 'PE_REVISION_CONFLICT'; end if;
  insert into public.pe_commerce_offer_revisions(revision,instrument_id,instrument_version,area_codes,configuration,created_by)
    values(s.revision+1,old.instrument_id,old.instrument_version,old.area_codes,p_configuration,p_actor) returning id into v_id;
  update public.pe_commerce_settings set revision=s.revision+1,offer_id=v_id where id;
  insert into public.pe_commerce_audit(actor_id,offer_id,action) values(p_actor,v_id,'draft_saved');
  return jsonb_build_object('revision',s.revision+1);
end; $$;

create or replace function public.pe_commerce_admin_dashboard(p_query text default '',p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.pe_commerce_settings; offer public.pe_commerce_offer_revisions; rows jsonb; total int;
begin
  if p_query is null or length(p_query)>100 or p_status is null or p_status not in
    ('all','awaiting_payment','paid','cancelled','refund_pending','partially_refunded','refunded','disputed') then raise exception 'PE_INVALID_REQUEST'; end if;
  select * into s from public.pe_commerce_settings where id;
  if not found then raise exception 'PE_COMMERCE_SETUP_REQUIRED'; end if;
  select * into strict offer from public.pe_commerce_offer_revisions where id=s.offer_id;
  select count(*)::int into total from public.pe_commerce_orders o join public.pe_commerce_customers c on c.id=o.customer_id
    where (p_status='all' or o.status=p_status) and (p_query='' or strpos(lower(o.id::text||' '||c.email),lower(p_query))>0);
  select coalesce(jsonb_agg(row order by row->>'createdAt' desc,row->>'id' desc),'[]') into rows from (
    select jsonb_build_object('id',o.id,'email',c.email,'totalIdr',o.total_idr,'status',o.status,'createdAt',o.created_at,
      'accessStatus',(select e.status from public.pe_commerce_entitlements e where e.order_id=o.id)) as row
    from public.pe_commerce_orders o join public.pe_commerce_customers c on c.id=o.customer_id
    where (p_status='all' or o.status=p_status) and (p_query='' or strpos(lower(o.id::text||' '||c.email),lower(p_query))>0)
    order by o.created_at desc,o.id desc limit 50
  ) items;
  return jsonb_build_object('revision',s.revision,'offerId',offer.id,'configuration',offer.configuration,
    'areaCodes',offer.area_codes,'instrumentVersion',offer.instrument_version,'orders',rows,'matchedCount',total,
    'counts',jsonb_build_object('pending',(select count(*) from public.pe_commerce_orders where status='awaiting_payment'),
      'paid',(select count(*) from public.pe_commerce_orders where status='paid'),
      'attention',(select count(*) from public.pe_commerce_orders where status in ('refund_pending','disputed'))));
end; $$;

-- No direct row mutation, public SELECT, or executable grant/checkout RPC.
do $$ declare t text; begin
  foreach t in array array['pe_commerce_offer_revisions','pe_commerce_settings','pe_commerce_customers',
    'pe_commerce_orders','pe_commerce_payment_attempts','pe_commerce_entitlements','pe_commerce_payment_events','pe_commerce_outbox','pe_commerce_audit'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  end loop;
end; $$;
revoke all on function public.pe_commerce_save_draft(int,jsonb,uuid),public.pe_commerce_admin_dashboard(text,text) from public,anon,authenticated,service_role;
grant execute on function public.pe_commerce_save_draft(int,jsonb,uuid),public.pe_commerce_admin_dashboard(text,text) to service_role;
commit;
