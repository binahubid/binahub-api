-- Phase 5: governed acquisition sources, campaigns, prospect staging, and
-- idempotent promotion into the existing leads system of record.

begin;

alter table public.operational_tasks
  drop constraint if exists operational_tasks_type_valid;
alter table public.operational_tasks
  add constraint operational_tasks_type_valid check (
    task_type in (
      'client_review', 'renewal_review', 'account_risk', 'delivery_risk',
      'milestone_overdue', 'retention_action', 'proposal_review',
      'acquisition_review', 'system_alert'
    )
  );

create table if not exists public.acquisition_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  name text not null,
  provider_type text not null,
  channel text not null,
  acquisition_method text not null,
  lawful_basis text,
  privacy_notice_url text,
  retention_days integer,
  data_owner text,
  legal_owner text,
  status text not null default 'draft',
  active boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acquisition_sources_key_valid check (source_key ~ '^[a-z][a-z0-9_-]{2,63}$'),
  constraint acquisition_sources_provider_valid check (
    provider_type in ('manual_upload', 'website', 'google_ads', 'meta_ads', 'microsoft_ads', 'apollo', 'linkedin', 'google_maps', 'referral', 'partner', 'other')
  ),
  constraint acquisition_sources_channel_valid check (channel in ('inbound', 'outbound', 'partner', 'offline')),
  constraint acquisition_sources_basis_valid check (
    lawful_basis is null or lawful_basis in ('consent', 'legitimate_interest', 'contract', 'legal_obligation', 'public_task', 'not_applicable')
  ),
  constraint acquisition_sources_status_valid check (status in ('draft', 'approved', 'paused', 'rejected')),
  constraint acquisition_sources_retention_valid check (retention_days is null or retention_days between 1 and 3650),
  constraint acquisition_sources_approval_valid check (
    status <> 'approved'
    or (
      lawful_basis is not null
      and retention_days is not null
      and data_owner is not null
      and legal_owner is not null
      and approved_by is not null
      and approved_at is not null
      and approval_note is not null
      and length(btrim(approval_note)) >= 5
      and (channel <> 'outbound' or (privacy_notice_url is not null and length(btrim(privacy_notice_url)) >= 10))
    )
  )
);

create table if not exists public.acquisition_campaigns (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.acquisition_sources(id) on delete restrict,
  campaign_code text not null unique,
  name text not null,
  objective text not null,
  channel text not null,
  status text not null default 'draft',
  owner text not null,
  budget_amount numeric(14,2),
  currency text not null default 'IDR',
  starts_on date,
  ends_on date,
  utm_config jsonb not null default '{}'::jsonb,
  target_definition jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acquisition_campaigns_code_valid check (campaign_code ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
  constraint acquisition_campaigns_objective_valid check (objective in ('awareness', 'traffic', 'assessment', 'consultation', 'lead_generation')),
  constraint acquisition_campaigns_channel_valid check (channel in ('email', 'google_ads', 'meta_ads', 'microsoft_ads', 'linkedin', 'referral', 'organic', 'other')),
  constraint acquisition_campaigns_status_valid check (status in ('draft', 'approved', 'active', 'paused', 'completed', 'cancelled')),
  constraint acquisition_campaigns_budget_valid check (budget_amount is null or budget_amount >= 0),
  constraint acquisition_campaigns_currency_valid check (currency ~ '^[A-Z]{3}$'),
  constraint acquisition_campaigns_dates_valid check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint acquisition_campaigns_approval_valid check (
    status not in ('approved', 'active')
    or (approved_by is not null and approved_at is not null and approval_note is not null and length(btrim(approval_note)) >= 5)
  )
);

create table if not exists public.prospect_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.acquisition_sources(id) on delete restrict,
  campaign_id uuid references public.acquisition_campaigns(id) on delete set null,
  import_key text not null unique,
  file_name text,
  file_checksum text,
  status text not null default 'staged',
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  invalid_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  suppressed_rows integer not null default 0,
  promoted_rows integer not null default 0,
  legal_snapshot jsonb not null default '{}'::jsonb,
  approved_by text,
  approved_at timestamptz,
  approval_note text,
  error_message text,
  created_by text not null,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_import_batches_status_valid check (status in ('staged', 'approved', 'processing', 'completed', 'rejected', 'failed')),
  constraint prospect_import_batches_counts_valid check (
    total_rows >= 0 and valid_rows >= 0 and invalid_rows >= 0 and duplicate_rows >= 0 and suppressed_rows >= 0 and promoted_rows >= 0
  ),
  constraint prospect_import_batches_approval_valid check (
    status <> 'approved'
    or (approved_by is not null and approved_at is not null and approval_note is not null and length(btrim(approval_note)) >= 5)
  )
);

create table if not exists public.acquisition_prospects (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.prospect_import_batches(id) on delete cascade,
  source_id uuid not null references public.acquisition_sources(id) on delete restrict,
  campaign_id uuid references public.acquisition_campaigns(id) on delete set null,
  external_id text,
  name text not null,
  email text not null,
  email_normalized text generated always as (lower(btrim(email))) stored,
  company text,
  phone text,
  role_title text,
  industry text,
  location text,
  employee_range text,
  website_url text,
  linkedin_url text,
  source_url text,
  consent_status text not null default 'unknown',
  lawful_basis_snapshot text,
  validation_status text not null default 'pending',
  validation_reasons text[] not null default '{}',
  raw_data jsonb not null default '{}'::jsonb,
  matched_lead_id uuid references public.leads(id) on delete set null,
  promoted_at timestamptz,
  promoted_by text,
  created_at timestamptz not null default now(),
  constraint acquisition_prospects_email_normalized check (email = lower(btrim(email)) and length(email) <= 320),
  constraint acquisition_prospects_consent_valid check (consent_status in ('unknown', 'opted_in', 'not_required', 'opted_out')),
  constraint acquisition_prospects_validation_valid check (validation_status in ('pending', 'valid', 'invalid', 'duplicate', 'suppressed', 'excluded'))
);

create index if not exists acquisition_sources_status_idx on public.acquisition_sources (status, active, updated_at desc);
create index if not exists acquisition_campaigns_status_idx on public.acquisition_campaigns (status, starts_on, ends_on);
create index if not exists prospect_import_batches_queue_idx on public.prospect_import_batches (status, created_at);
create index if not exists acquisition_prospects_batch_status_idx on public.acquisition_prospects (batch_id, validation_status);
create index if not exists acquisition_prospects_email_idx on public.acquisition_prospects (email_normalized, created_at desc);

create table if not exists public.acquisition_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.acquisition_sources(id) on delete set null,
  campaign_id uuid references public.acquisition_campaigns(id) on delete set null,
  batch_id uuid references public.prospect_import_batches(id) on delete set null,
  prospect_id uuid references public.acquisition_prospects(id) on delete set null,
  event_type text not null,
  actor text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint acquisition_events_type_valid check (event_type ~ '^[a-z][a-z0-9_]{2,79}$')
);

create index if not exists acquisition_events_created_idx on public.acquisition_events (created_at desc);
create index if not exists acquisition_events_batch_idx on public.acquisition_events (batch_id, created_at desc);

drop trigger if exists acquisition_sources_set_updated_at on public.acquisition_sources;
create trigger acquisition_sources_set_updated_at before update on public.acquisition_sources
for each row execute function public.set_updated_at();
drop trigger if exists acquisition_campaigns_set_updated_at on public.acquisition_campaigns;
create trigger acquisition_campaigns_set_updated_at before update on public.acquisition_campaigns
for each row execute function public.set_updated_at();
drop trigger if exists prospect_import_batches_set_updated_at on public.prospect_import_batches;
create trigger prospect_import_batches_set_updated_at before update on public.prospect_import_batches
for each row execute function public.set_updated_at();

alter table public.acquisition_sources enable row level security;
alter table public.acquisition_campaigns enable row level security;
alter table public.prospect_import_batches enable row level security;
alter table public.acquisition_prospects enable row level security;
alter table public.acquisition_events enable row level security;

revoke all on table public.acquisition_sources, public.acquisition_campaigns,
  public.prospect_import_batches, public.acquisition_prospects, public.acquisition_events
from public, anon, authenticated;
grant select, insert, update on table public.acquisition_sources, public.acquisition_campaigns,
  public.prospect_import_batches, public.acquisition_prospects to service_role;
grant select, insert on table public.acquisition_events to service_role;

create or replace function public.save_acquisition_source(
  p_id uuid, p_actor text, p_source_key text, p_name text, p_provider_type text,
  p_channel text, p_acquisition_method text, p_lawful_basis text,
  p_privacy_notice_url text, p_retention_days integer, p_data_owner text,
  p_legal_owner text, p_status text, p_active boolean, p_config jsonb,
  p_human_approved boolean, p_approval_note text
)
returns public.acquisition_sources
language plpgsql security definer set search_path = public, pg_temp
as $$
declare saved public.acquisition_sources%rowtype;
begin
  if p_status not in ('draft', 'approved', 'paused', 'rejected') then raise exception 'INVALID_ACQUISITION_SOURCE_STATUS' using errcode='22023'; end if;
  if p_status = 'approved' and (
    not coalesce(p_human_approved, false) or p_lawful_basis is null or p_retention_days is null
    or p_data_owner is null or p_legal_owner is null or p_approval_note is null or length(btrim(p_approval_note)) < 5
    or (p_channel = 'outbound' and (p_privacy_notice_url is null or length(btrim(p_privacy_notice_url)) < 10))
  ) then raise exception 'ACQUISITION_SOURCE_APPROVAL_REQUIRED' using errcode='22023'; end if;
  if p_active and p_status <> 'approved' then raise exception 'ONLY_APPROVED_SOURCE_CAN_BE_ACTIVE' using errcode='22023'; end if;

  if p_id is null then
    insert into public.acquisition_sources (
      source_key,name,provider_type,channel,acquisition_method,lawful_basis,privacy_notice_url,
      retention_days,data_owner,legal_owner,status,active,config,approved_by,approved_at,approval_note,created_by,updated_by
    ) values (
      lower(btrim(p_source_key)),btrim(p_name),p_provider_type,p_channel,btrim(p_acquisition_method),p_lawful_basis,
      nullif(btrim(p_privacy_notice_url),''),p_retention_days,nullif(lower(btrim(p_data_owner)),''),nullif(lower(btrim(p_legal_owner)),''),
      p_status,coalesce(p_active,false),coalesce(p_config,'{}'::jsonb),case when p_status='approved' then btrim(p_actor) end,
      case when p_status='approved' then now() end,case when p_status='approved' then btrim(p_approval_note) end,btrim(p_actor),btrim(p_actor)
    ) returning * into saved;
  else
    update public.acquisition_sources set
      source_key=lower(btrim(p_source_key)),name=btrim(p_name),provider_type=p_provider_type,channel=p_channel,
      acquisition_method=btrim(p_acquisition_method),lawful_basis=p_lawful_basis,privacy_notice_url=nullif(btrim(p_privacy_notice_url),''),
      retention_days=p_retention_days,data_owner=nullif(lower(btrim(p_data_owner)),''),legal_owner=nullif(lower(btrim(p_legal_owner)),''),
      status=p_status,active=coalesce(p_active,false),config=coalesce(p_config,'{}'::jsonb),
      approved_by=case when p_status='approved' then btrim(p_actor) end,approved_at=case when p_status='approved' then coalesce(approved_at,now()) end,
      approval_note=case when p_status='approved' then btrim(p_approval_note) end,updated_by=btrim(p_actor)
    where id=p_id returning * into saved;
    if not found then raise exception 'ACQUISITION_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  insert into public.acquisition_events(source_id,event_type,actor,note,metadata)
  values(saved.id,'acquisition_source_saved',btrim(p_actor),nullif(btrim(p_approval_note),''),jsonb_build_object('status',saved.status,'active',saved.active));
  return saved;
end; $$;

revoke all on function public.save_acquisition_source(uuid,text,text,text,text,text,text,text,text,integer,text,text,text,boolean,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.save_acquisition_source(uuid,text,text,text,text,text,text,text,text,integer,text,text,text,boolean,jsonb,boolean,text) to service_role;

create or replace function public.save_acquisition_campaign(
  p_id uuid, p_actor text, p_source_id uuid, p_campaign_code text, p_name text,
  p_objective text, p_channel text, p_status text, p_owner text, p_budget_amount numeric,
  p_currency text, p_starts_on date, p_ends_on date, p_utm_config jsonb,
  p_target_definition jsonb, p_human_approved boolean, p_approval_note text
)
returns public.acquisition_campaigns
language plpgsql security definer set search_path = public, pg_temp
as $$
declare saved public.acquisition_campaigns%rowtype; source_status text;
begin
  select status into source_status from public.acquisition_sources where id=p_source_id;
  if source_status is null then raise exception 'ACQUISITION_SOURCE_NOT_FOUND' using errcode='P0002'; end if;
  if p_status in ('approved','active') and (
    source_status <> 'approved' or not coalesce(p_human_approved,false) or p_approval_note is null or length(btrim(p_approval_note)) < 5
  ) then raise exception 'ACQUISITION_CAMPAIGN_APPROVAL_REQUIRED' using errcode='22023'; end if;
  if p_status='active' and (p_starts_on is null or p_ends_on is null) then raise exception 'ACTIVE_CAMPAIGN_DATES_REQUIRED' using errcode='22023'; end if;

  if p_id is null then
    insert into public.acquisition_campaigns(source_id,campaign_code,name,objective,channel,status,owner,budget_amount,currency,starts_on,ends_on,utm_config,target_definition,approved_by,approved_at,approval_note,created_by,updated_by)
    values(p_source_id,upper(btrim(p_campaign_code)),btrim(p_name),p_objective,p_channel,p_status,lower(btrim(p_owner)),p_budget_amount,upper(p_currency),p_starts_on,p_ends_on,coalesce(p_utm_config,'{}'),coalesce(p_target_definition,'{}'),case when p_status in ('approved','active') then btrim(p_actor) end,case when p_status in ('approved','active') then now() end,case when p_status in ('approved','active') then btrim(p_approval_note) end,btrim(p_actor),btrim(p_actor)) returning * into saved;
  else
    update public.acquisition_campaigns set source_id=p_source_id,campaign_code=upper(btrim(p_campaign_code)),name=btrim(p_name),objective=p_objective,channel=p_channel,status=p_status,owner=lower(btrim(p_owner)),budget_amount=p_budget_amount,currency=upper(p_currency),starts_on=p_starts_on,ends_on=p_ends_on,utm_config=coalesce(p_utm_config,'{}'),target_definition=coalesce(p_target_definition,'{}'),approved_by=case when p_status in ('approved','active') then btrim(p_actor) end,approved_at=case when p_status in ('approved','active') then coalesce(approved_at,now()) end,approval_note=case when p_status in ('approved','active') then btrim(p_approval_note) end,updated_by=btrim(p_actor)
    where id=p_id returning * into saved;
    if not found then raise exception 'ACQUISITION_CAMPAIGN_NOT_FOUND' using errcode='P0002'; end if;
  end if;
  insert into public.acquisition_events(source_id,campaign_id,event_type,actor,note,metadata)
  values(saved.source_id,saved.id,'acquisition_campaign_saved',btrim(p_actor),nullif(btrim(p_approval_note),''),jsonb_build_object('status',saved.status));
  return saved;
end; $$;

revoke all on function public.save_acquisition_campaign(uuid,text,uuid,text,text,text,text,text,text,numeric,text,date,date,jsonb,jsonb,boolean,text) from public,anon,authenticated;
grant execute on function public.save_acquisition_campaign(uuid,text,uuid,text,text,text,text,text,text,numeric,text,date,date,jsonb,jsonb,boolean,text) to service_role;

create or replace function public.stage_acquisition_batch(
  p_source_id uuid, p_campaign_id uuid, p_import_key text, p_file_name text,
  p_file_checksum text, p_prospects jsonb, p_actor text
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare source_record public.acquisition_sources%rowtype; batch_record public.prospect_import_batches%rowtype;
  item jsonb; normalized_email text; reasons text[]; validation text; existing_batch public.prospect_import_batches%rowtype;
begin
  select * into existing_batch from public.prospect_import_batches where import_key=p_import_key;
  if found then return jsonb_build_object('success',true,'duplicate',true,'batchId',existing_batch.id,'status',existing_batch.status,'totalRows',existing_batch.total_rows); end if;
  select * into source_record from public.acquisition_sources where id=p_source_id and status='approved' and active;
  if not found then raise exception 'APPROVED_ACTIVE_SOURCE_REQUIRED' using errcode='22023'; end if;
  if p_campaign_id is not null and not exists(select 1 from public.acquisition_campaigns where id=p_campaign_id and source_id=p_source_id and status in ('approved','active')) then
    raise exception 'APPROVED_CAMPAIGN_REQUIRED' using errcode='22023';
  end if;
  if jsonb_typeof(p_prospects)<>'array' or jsonb_array_length(p_prospects) not between 1 and 500 then raise exception 'INVALID_PROSPECT_BATCH_SIZE' using errcode='22023'; end if;

  insert into public.prospect_import_batches(source_id,campaign_id,import_key,file_name,file_checksum,status,legal_snapshot,created_by,updated_by)
  values(p_source_id,p_campaign_id,btrim(p_import_key),nullif(btrim(p_file_name),''),nullif(btrim(p_file_checksum),''),'staged',
    jsonb_build_object('sourceKey',source_record.source_key,'lawfulBasis',source_record.lawful_basis,'retentionDays',source_record.retention_days,'approvedBy',source_record.approved_by,'approvedAt',source_record.approved_at),btrim(p_actor),btrim(p_actor))
  returning * into batch_record;

  for item in select value from jsonb_array_elements(p_prospects) loop
    normalized_email:=lower(btrim(coalesce(item->>'email',''))); reasons:='{}'; validation:='valid';
    if coalesce(item->>'name','')='' then reasons:=array_append(reasons,'NAME_REQUIRED'); validation:='invalid'; end if;
    if normalized_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then reasons:=array_append(reasons,'INVALID_EMAIL'); validation:='invalid'; end if;
    if lower(coalesce(item->>'consentStatus','unknown'))='opted_out' then reasons:=array_append(reasons,'OPTED_OUT'); validation:='excluded'; end if;
    if exists(select 1 from public.email_suppressions where email=normalized_email) then reasons:=array_append(reasons,'EMAIL_SUPPRESSED'); validation:='suppressed'; end if;
    if exists(select 1 from public.leads where lower(btrim(email))=normalized_email) then reasons:=array_append(reasons,'EXISTING_LEAD'); validation:='duplicate'; end if;
    if exists(select 1 from public.acquisition_prospects where batch_id=batch_record.id and email_normalized=normalized_email) then reasons:=array_append(reasons,'DUPLICATE_IN_BATCH'); validation:='duplicate'; end if;

    insert into public.acquisition_prospects(batch_id,source_id,campaign_id,external_id,name,email,company,phone,role_title,industry,location,employee_range,website_url,linkedin_url,source_url,consent_status,lawful_basis_snapshot,validation_status,validation_reasons,raw_data)
    values(batch_record.id,p_source_id,p_campaign_id,nullif(btrim(item->>'externalId'),''),coalesce(nullif(btrim(item->>'name'),''),'Tidak diketahui'),normalized_email,nullif(btrim(item->>'company'),''),nullif(btrim(item->>'phone'),''),nullif(btrim(item->>'roleTitle'),''),nullif(btrim(item->>'industry'),''),nullif(btrim(item->>'location'),''),nullif(btrim(item->>'employeeRange'),''),nullif(btrim(item->>'websiteUrl'),''),nullif(btrim(item->>'linkedinUrl'),''),nullif(btrim(item->>'sourceUrl'),''),coalesce(nullif(lower(btrim(item->>'consentStatus')),''),'unknown'),source_record.lawful_basis,validation,reasons,item);
  end loop;

  update public.prospect_import_batches set
    total_rows=(select count(*) from public.acquisition_prospects where batch_id=batch_record.id),
    valid_rows=(select count(*) from public.acquisition_prospects where batch_id=batch_record.id and validation_status='valid'),
    invalid_rows=(select count(*) from public.acquisition_prospects where batch_id=batch_record.id and validation_status='invalid'),
    duplicate_rows=(select count(*) from public.acquisition_prospects where batch_id=batch_record.id and validation_status='duplicate'),
    suppressed_rows=(select count(*) from public.acquisition_prospects where batch_id=batch_record.id and validation_status in ('suppressed','excluded'))
  where id=batch_record.id returning * into batch_record;

  insert into public.operational_tasks(task_key,task_type,title,description,priority,status,assigned_to,due_at,sla_policy_key,metadata,created_by,updated_by)
  values('acquisition-review:'||batch_record.id,'acquisition_review','Review batch acquisition','Periksa legal snapshot, validasi, duplikasi, suppression, dan bukti sumber sebelum approval.','high','open',source_record.data_owner,now()+interval '1 day','acquisition_batch_review',jsonb_build_object('batchId',batch_record.id,'sourceId',p_source_id,'validRows',batch_record.valid_rows),btrim(p_actor),btrim(p_actor))
  on conflict(task_key) do nothing;
  insert into public.acquisition_events(source_id,campaign_id,batch_id,event_type,actor,metadata)
  values(p_source_id,p_campaign_id,batch_record.id,'prospect_batch_staged',btrim(p_actor),jsonb_build_object('totalRows',batch_record.total_rows,'validRows',batch_record.valid_rows,'invalidRows',batch_record.invalid_rows,'duplicateRows',batch_record.duplicate_rows,'suppressedRows',batch_record.suppressed_rows));
  return jsonb_build_object('success',true,'duplicate',false,'batchId',batch_record.id,'totalRows',batch_record.total_rows,'validRows',batch_record.valid_rows,'invalidRows',batch_record.invalid_rows,'duplicateRows',batch_record.duplicate_rows,'suppressedRows',batch_record.suppressed_rows);
end; $$;

revoke all on function public.stage_acquisition_batch(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.stage_acquisition_batch(uuid,uuid,text,text,text,jsonb,text) to service_role;

create or replace function public.review_acquisition_batch(p_batch_id uuid,p_actor text,p_decision text,p_note text)
returns public.prospect_import_batches
language plpgsql security definer set search_path = public, pg_temp
as $$
declare saved public.prospect_import_batches%rowtype; review_task public.operational_tasks%rowtype;
begin
  if p_decision not in ('approved','rejected') then raise exception 'INVALID_BATCH_DECISION' using errcode='22023'; end if;
  if p_note is null or length(btrim(p_note))<5 then raise exception 'BATCH_REVIEW_NOTE_REQUIRED' using errcode='22023'; end if;
  if p_decision='approved' and not exists(
    select 1 from public.prospect_import_batches batch join public.acquisition_sources source on source.id=batch.source_id
    where batch.id=p_batch_id and batch.status='staged' and batch.valid_rows>0 and source.status='approved' and source.active
      and (
        batch.campaign_id is null
        or exists(
          select 1 from public.acquisition_campaigns campaign
          where campaign.id=batch.campaign_id and campaign.source_id=batch.source_id and campaign.status in ('approved','active')
        )
      )
  ) then raise exception 'BATCH_NOT_APPROVABLE' using errcode='22023'; end if;
  update public.prospect_import_batches set status=p_decision,approved_by=case when p_decision='approved' then btrim(p_actor) end,approved_at=case when p_decision='approved' then now() end,approval_note=btrim(p_note),updated_by=btrim(p_actor)
  where id=p_batch_id and status='staged' returning * into saved;
  if not found then raise exception 'BATCH_NOT_FOUND_OR_REVIEWED' using errcode='P0002'; end if;
  select * into review_task from public.operational_tasks where task_key='acquisition-review:'||p_batch_id for update;
  if found then
    perform public.update_operational_task(review_task.id,btrim(p_actor),'completed',review_task.priority,review_task.assigned_to,review_task.due_at,btrim(p_note));
  end if;
  insert into public.acquisition_events(source_id,campaign_id,batch_id,event_type,actor,note,metadata)
  values(saved.source_id,saved.campaign_id,saved.id,'prospect_batch_'||p_decision,btrim(p_actor),btrim(p_note),jsonb_build_object('validRows',saved.valid_rows));
  return saved;
end; $$;

revoke all on function public.review_acquisition_batch(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.review_acquisition_batch(uuid,text,text,text) to service_role;

create or replace function public.promote_acquisition_batch(p_batch_id uuid,p_actor text,p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare batch_record public.prospect_import_batches%rowtype; source_record public.acquisition_sources%rowtype;
  prospect public.acquisition_prospects%rowtype; lead_id uuid; candidate_total integer:=0; promoted_total integer:=0; duplicate_total integer:=0; candidate_payload jsonb:='[]';
begin
  select * into batch_record from public.prospect_import_batches where id=p_batch_id and status='approved' for update;
  if not found then raise exception 'APPROVED_BATCH_REQUIRED' using errcode='22023'; end if;
  select * into source_record from public.acquisition_sources where id=batch_record.source_id and status='approved' and active;
  if not found then raise exception 'APPROVED_ACTIVE_SOURCE_REQUIRED' using errcode='22023'; end if;
  if batch_record.campaign_id is not null and not exists(
    select 1 from public.acquisition_campaigns
    where id=batch_record.campaign_id and source_id=batch_record.source_id and status in ('approved','active')
  ) then raise exception 'APPROVED_CAMPAIGN_REQUIRED' using errcode='22023'; end if;
  select count(*),coalesce(jsonb_agg(jsonb_build_object('prospectId',id,'name',name,'email',email,'company',company)),'[]')
  into candidate_total,candidate_payload from public.acquisition_prospects
  where batch_id=p_batch_id and validation_status='valid' and matched_lead_id is null
    and not exists(select 1 from public.email_suppressions suppression where suppression.email=acquisition_prospects.email_normalized);
  if coalesce(p_dry_run,true) then return jsonb_build_object('success',true,'dryRun',true,'batchId',p_batch_id,'candidateCount',candidate_total,'promotedCount',0,'candidates',candidate_payload); end if;

  update public.prospect_import_batches set status='processing',updated_by=btrim(p_actor) where id=p_batch_id;
  for prospect in select * from public.acquisition_prospects where batch_id=p_batch_id and validation_status='valid' and matched_lead_id is null order by created_at loop
    perform pg_advisory_xact_lock(hashtextextended(prospect.email_normalized,0));
    if exists(select 1 from public.email_suppressions where email=prospect.email_normalized) then
      update public.acquisition_prospects set validation_status='suppressed',validation_reasons=array_append(validation_reasons,'EMAIL_SUPPRESSED_AT_PROMOTION') where id=prospect.id;
      continue;
    end if;
    select id into lead_id from public.leads where lower(btrim(email))=prospect.email_normalized limit 1;
    if lead_id is null then
      insert into public.leads(name,email,company,phone,source,lead_status,lifecycle_stage,opportunity_stage,source_metadata,last_meaningful_activity_at)
      values(prospect.name,prospect.email_normalized,prospect.company,prospect.phone,'acquisition:'||source_record.source_key,'new','consumer','identified',jsonb_build_object('acquisitionSourceId',source_record.id,'acquisitionSourceKey',source_record.source_key,'campaignId',batch_record.campaign_id,'batchId',batch_record.id,'prospectId',prospect.id,'lawfulBasis',prospect.lawful_basis_snapshot),now()) returning id into lead_id;
      promoted_total:=promoted_total+1;
      update public.acquisition_prospects set matched_lead_id=lead_id,promoted_at=now(),promoted_by=btrim(p_actor) where id=prospect.id;
    else
      duplicate_total:=duplicate_total+1;
      update public.acquisition_prospects set validation_status='duplicate',validation_reasons=array_append(validation_reasons,'EXISTING_LEAD_AT_PROMOTION'),matched_lead_id=lead_id where id=prospect.id;
    end if;
  end loop;
  update public.prospect_import_batches set status='completed',promoted_rows=promoted_total,duplicate_rows=duplicate_rows+duplicate_total,updated_by=btrim(p_actor) where id=p_batch_id returning * into batch_record;
  insert into public.acquisition_events(source_id,campaign_id,batch_id,event_type,actor,metadata)
  values(batch_record.source_id,batch_record.campaign_id,batch_record.id,'prospect_batch_promoted',btrim(p_actor),jsonb_build_object('candidateCount',candidate_total,'promotedCount',promoted_total,'duplicateAtPromotion',duplicate_total));
  return jsonb_build_object('success',true,'dryRun',false,'batchId',p_batch_id,'candidateCount',candidate_total,'promotedCount',promoted_total,'duplicateCount',duplicate_total);
end; $$;

revoke all on function public.promote_acquisition_batch(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.promote_acquisition_batch(uuid,text,boolean) to service_role;

comment on table public.acquisition_prospects is 'Governed staging area; records are never contacted directly and only approved valid rows may become consumer leads.';
comment on function public.promote_acquisition_batch(uuid,text,boolean) is 'Idempotently promotes an approved batch into existing leads without sending outreach.';

commit;
