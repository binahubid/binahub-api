-- App-managed sales controls. Creates paused settings; does NOT activate sending.
begin;

-- Independent sales follow-up switch. New installation starts paused; legacy backlog is NOT enrolled.
create table if not exists public.sales_follow_up_settings (
  id boolean primary key default true check(id), enabled boolean not null default false,
  activated_at timestamptz, version integer not null default 1 check(version>0),
  updated_by text not null, updated_at timestamptz not null default now()
);
create table if not exists public.sales_follow_up_settings_audit (
  id uuid primary key default gen_random_uuid(),actor text not null,before_settings jsonb,after_settings jsonb not null,created_at timestamptz not null default now()
);
insert into public.sales_follow_up_settings(id,updated_by) values(true,'migration-0061') on conflict do nothing;
alter table public.sales_follow_up_settings enable row level security;
alter table public.sales_follow_up_settings_audit enable row level security;
revoke all on public.sales_follow_up_settings,public.sales_follow_up_settings_audit from anon,authenticated;
grant all on public.sales_follow_up_settings,public.sales_follow_up_settings_audit to service_role;
create or replace function public.save_sales_follow_up_settings(p_enabled boolean,p_expected_version integer,p_actor text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare prior public.sales_follow_up_settings; saved public.sales_follow_up_settings;
begin
  select * into prior from public.sales_follow_up_settings where id=true for update;
  if prior.version is null or prior.version<>p_expected_version then raise exception 'SALES_SETTINGS_CONFLICT'; end if;
  if p_enabled is null or p_actor is null or p_actor !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'INVALID_SALES_SETTINGS'; end if;
  update public.sales_follow_up_settings set enabled=p_enabled,
    activated_at=case when p_enabled and not prior.enabled then now() else prior.activated_at end,
    version=prior.version+1,updated_by=lower(btrim(p_actor)),updated_at=now() where id=true returning * into saved;
  insert into public.sales_follow_up_settings_audit(actor,before_settings,after_settings) values(saved.updated_by,to_jsonb(prior),to_jsonb(saved));
  return to_jsonb(saved);
end; $$;
revoke all on function public.save_sales_follow_up_settings(boolean,integer,text) from public,anon,authenticated;
grant execute on function public.save_sales_follow_up_settings(boolean,integer,text) to service_role;

-- The admin has previewed the imported list and explicitly authorized its use.
-- Database validation still excludes invalid, duplicate and suppressed addresses. No email is sent.
create or replace function public.stage_reviewed_acquisition_batch(
  p_source_id uuid, p_campaign_id uuid, p_import_key text, p_file_name text,
  p_file_checksum text, p_prospects jsonb, p_actor text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare staged jsonb;
begin
  staged := public.stage_acquisition_batch(p_source_id,p_campaign_id,p_import_key,p_file_name,p_file_checksum,p_prospects,p_actor);
  if not coalesce((staged->>'duplicate')::boolean,false) and coalesce((staged->>'validRows')::integer,0)>0 then
    perform public.review_acquisition_batch((staged->>'batchId')::uuid,p_actor,'approved','Daftar ditinjau dan penggunaannya dikonfirmasi admin pada preview impor outbound. Hanya target valid digunakan.');
  end if;
  return staged;
end; $$;
revoke all on function public.stage_reviewed_acquisition_batch(uuid,uuid,text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.stage_reviewed_acquisition_batch(uuid,uuid,text,text,text,jsonb,text) to service_role;
create table if not exists public.outbound_campaign_settings (
  campaign_id uuid primary key references public.acquisition_campaigns(id) on delete restrict,
  enabled boolean not null default false,
  recipient_mode text not null default 'restricted' check (recipient_mode in ('restricted','approved_list')),
  allowed_emails text[] not null default '{}',
  business_hours_only boolean not null default false,
  version integer not null check (version > 0),
  updated_by text not null,
  updated_at timestamptz not null default now(),
  check (cardinality(allowed_emails) <= 50),
  check (not enabled or recipient_mode = 'approved_list' or cardinality(allowed_emails) > 0)
);
create table if not exists public.outbound_settings_audit (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.acquisition_campaigns(id) on delete restrict,
  actor text not null, before_settings jsonb, after_settings jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.outbound_campaign_settings enable row level security;
alter table public.outbound_settings_audit enable row level security;
revoke all on public.outbound_campaign_settings, public.outbound_settings_audit from anon, authenticated;
grant all on public.outbound_campaign_settings, public.outbound_settings_audit to service_role;
alter table public.outbound_email_jobs add column if not exists settings_version integer not null default 0;

create or replace function public.save_outbound_settings(
  p_campaign_id uuid, p_enabled boolean, p_recipient_mode text, p_allowed_emails text[],
  p_business_hours_only boolean, p_expected_version integer, p_actor text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare prior public.outbound_campaign_settings; saved public.outbound_campaign_settings; emails text[];
begin
  -- Serializes first creation as well as concurrent edits/queue creation for this campaign.
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 61));
  select * into prior from public.outbound_campaign_settings where campaign_id=p_campaign_id for update;
  if coalesce(prior.version,0) <> p_expected_version then raise exception 'OUTBOUND_SETTINGS_CONFLICT'; end if;
  if p_actor is null or p_actor !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_enabled is null or p_business_hours_only is null or p_recipient_mode not in ('restricted','approved_list')
    or p_allowed_emails is null or cardinality(p_allowed_emails)>50 then raise exception 'INVALID_OUTBOUND_SETTINGS'; end if;
  if exists (select 1 from unnest(p_allowed_emails) email where email is null or btrim(email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'INVALID_OUTBOUND_EMAIL'; end if;
  select coalesce(array_agg(email order by email),'{}') into emails from (select distinct lower(btrim(email)) email from unnest(p_allowed_emails) email) normalized;
  insert into public.outbound_campaign_settings(campaign_id,enabled,recipient_mode,allowed_emails,business_hours_only,version,updated_by)
  values(p_campaign_id,p_enabled,p_recipient_mode,emails,p_business_hours_only,coalesce(prior.version,0)+1,lower(btrim(p_actor)))
  on conflict(campaign_id) do update set enabled=excluded.enabled,recipient_mode=excluded.recipient_mode,allowed_emails=excluded.allowed_emails,
    business_hours_only=excluded.business_hours_only,version=excluded.version,updated_by=excluded.updated_by,updated_at=now()
  returning * into saved;
  insert into public.outbound_settings_audit(campaign_id,actor,before_settings,after_settings) values(p_campaign_id,saved.updated_by,case when prior.version is null then null else to_jsonb(prior) end,to_jsonb(saved));
  -- Old confirmed jobs must not be replayed under a new audience or after a pause/resume.
  update public.outbound_email_deliveries d set status='blocked',error_message='Pengaturan berubah atau pengiriman dijeda. Antrean ini tidak dikirim ulang otomatis.',updated_at=now()
    from public.outbound_email_jobs j where d.job_id=j.id and j.campaign_id=p_campaign_id and d.status='queued' and j.settings_version<>saved.version;
  return to_jsonb(saved);
end; $$;

-- Keep compatibility with the old queue signature as a default parameter, but refuse version 0.
drop function if exists public.queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb);
create or replace function public.queue_outbound_email(
  p_campaign_id uuid, p_request_key uuid, p_kind text, p_locale text,
  p_template_version text, p_template_hash text, p_subject text, p_html text,
  p_actor text, p_recipients jsonb, p_settings_version integer default 0
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare job_id uuid; recipient jsonb; inserted_count integer := 0; inserted_id uuid; control public.outbound_campaign_settings; prior_job public.outbound_email_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text, 61));
  select * into prior_job from public.outbound_email_jobs where request_key=p_request_key;
  if prior_job.id is not null then
    if prior_job.campaign_id<>p_campaign_id or prior_job.requested_by<>p_actor then raise exception 'OUTBOUND_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('jobId',prior_job.id,'duplicate',true,'queued',0);
  end if;
  select * into control from public.outbound_campaign_settings where campaign_id=p_campaign_id for share;
  if control.version is null or not control.enabled or control.version<>p_settings_version then raise exception 'OUTBOUND_SETTINGS_CHANGED_OR_PAUSED'; end if;
  if p_kind not in ('initial','test') or jsonb_typeof(p_recipients)<>'array' or jsonb_array_length(p_recipients) not between 1 and 50 then raise exception 'INVALID_OUTBOUND_QUEUE'; end if;
  if p_kind='test' and (jsonb_array_length(p_recipients)<>1 or lower(btrim(p_recipients->0->>'email'))<>p_actor) then raise exception 'OUTBOUND_TEST_ADMIN_ONLY'; end if;
  for recipient in select * from jsonb_array_elements(p_recipients) loop
    if p_kind='initial' and control.recipient_mode='restricted' and not lower(btrim(recipient->>'email'))=any(control.allowed_emails) then raise exception 'OUTBOUND_RECIPIENT_NOT_ALLOWED'; end if;
  end loop;
  insert into public.outbound_email_jobs(campaign_id,request_key,kind,locale,template_version,template_hash,subject_template,html_template,requested_by,settings_version)
  values(p_campaign_id,p_request_key,p_kind,p_locale,p_template_version,p_template_hash,p_subject,p_html,p_actor,p_settings_version)
  returning id into job_id;
  for recipient in select * from jsonb_array_elements(p_recipients) loop
    inserted_id := null;
    insert into public.outbound_email_deliveries(job_id,campaign_id,prospect_id,kind,email,name,company)
    values(job_id,p_campaign_id,nullif(recipient->>'prospectId','')::uuid,p_kind,lower(btrim(recipient->>'email')),recipient->>'name',recipient->>'company')
    on conflict do nothing returning id into inserted_id;
    if inserted_id is not null then inserted_count:=inserted_count+1; end if;
  end loop;
  return jsonb_build_object('jobId',job_id,'duplicate',false,'queued',inserted_count,'alreadyQueued',jsonb_array_length(p_recipients)-inserted_count);
end; $$;

-- One explicit send confirmation may activate a paused campaign and queue ONLY its selected recipients.
-- Atomic: any queue failure rolls activation back. Existing restricted settings are never broadened.
create or replace function public.activate_and_queue_outbound_email(
  p_campaign_id uuid, p_request_key uuid, p_kind text, p_locale text,
  p_template_version text, p_template_hash text, p_subject text, p_html text,
  p_actor text, p_recipients jsonb, p_settings_version integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare control public.outbound_campaign_settings; saved jsonb; prior_job public.outbound_email_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_campaign_id::text,61));
  select * into prior_job from public.outbound_email_jobs where request_key=p_request_key;
  if prior_job.id is not null then
    if prior_job.campaign_id<>p_campaign_id or prior_job.requested_by<>p_actor then raise exception 'OUTBOUND_REQUEST_CONFLICT'; end if;
    return jsonb_build_object('jobId',prior_job.id,'duplicate',true,'queued',0);
  end if;
  select * into control from public.outbound_campaign_settings where campaign_id=p_campaign_id for update;
  if coalesce(control.version,0)<>p_settings_version or coalesce(control.enabled,false) then raise exception 'OUTBOUND_SETTINGS_CONFLICT'; end if;
  saved := public.save_outbound_settings(p_campaign_id,true,coalesce(control.recipient_mode,'approved_list'),coalesce(control.allowed_emails,'{}'),coalesce(control.business_hours_only,false),p_settings_version,p_actor);
  return public.queue_outbound_email(p_campaign_id,p_request_key,p_kind,p_locale,p_template_version,p_template_hash,p_subject,p_html,p_actor,p_recipients,(saved->>'version')::integer);
end; $$;
revoke all on function public.activate_and_queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.activate_and_queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb,integer) to service_role;

create or replace function public.claim_outbound_email(p_job_id uuid default null,p_limit integer default 10,p_campaign_id uuid default null)
returns setof public.outbound_email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.outbound_email_deliveries set status='uncertain',error_message='Proses terhenti. Periksa arsip penyedia email sebelum pengiriman lain.',updated_at=now()
    where status='processing' and updated_at<now()-interval '10 minutes' and (p_job_id is null or job_id=p_job_id) and (p_campaign_id is null or campaign_id=p_campaign_id);
  return query update public.outbound_email_deliveries d set status='processing',updated_at=now() where d.id in (
    select q.id from public.outbound_email_deliveries q join public.outbound_email_jobs j on j.id=q.job_id
      join public.outbound_campaign_settings s on s.campaign_id=q.campaign_id
    where q.status='queued' and s.enabled and s.version=j.settings_version and (p_job_id is null or q.job_id=p_job_id) and (p_campaign_id is null or q.campaign_id=p_campaign_id)
      and (q.kind='test' or not s.business_hours_only or (extract(isodow from now() at time zone 'Asia/Jakarta') between 1 and 5 and extract(hour from now() at time zone 'Asia/Jakarta') between 8 and 16))
    order by q.created_at limit greatest(1,least(p_limit,10)) for update of q skip locked
  ) returning d.*;
end; $$;

revoke all on function public.save_outbound_settings(uuid,boolean,text,text[],boolean,integer,text) from public,anon,authenticated;
grant execute on function public.save_outbound_settings(uuid,boolean,text,text[],boolean,integer,text) to service_role;
revoke all on function public.queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb,integer) to service_role;
revoke all on function public.claim_outbound_email(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_outbound_email(uuid,integer,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
