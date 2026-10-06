-- Durable, admin-confirmed initial outreach. No email is sent and no safety gate is activated by this migration.
begin;

alter table public.outbound_campaign_links add column if not exists destination_path text not null default '/';
alter table public.outbound_campaign_links drop constraint if exists outbound_links_destination_valid;
alter table public.outbound_campaign_links add constraint outbound_links_destination_valid
  check (destination_path in ('/', '/insight', '/en/insight'));
comment on table public.acquisition_prospects is
  'Governed target staging. Initial email requires explicit admin confirmation, approved source/campaign/batch/template, runtime audience and suppression checks. Lead promotion remains a separate governed action.';

create table if not exists public.outbound_email_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.acquisition_campaigns(id) on delete restrict,
  request_key uuid not null unique,
  kind text not null check (kind in ('initial', 'test')),
  locale text not null check (locale in ('id', 'en')),
  template_version text not null,
  template_hash text not null,
  subject_template text not null,
  html_template text not null,
  requested_by text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.outbound_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.outbound_email_jobs(id) on delete restrict,
  campaign_id uuid not null references public.acquisition_campaigns(id) on delete restrict,
  prospect_id uuid references public.acquisition_prospects(id) on delete restrict,
  kind text not null check (kind in ('initial', 'test')),
  email text not null check (email = lower(btrim(email))),
  name text not null,
  company text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'blocked', 'uncertain')),
  provider_email_id text,
  link_id uuid references public.outbound_campaign_links(id) on delete restrict,
  error_message text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (kind = 'test' or prospect_id is not null)
);
-- A new import or double click must never resend the first marketing email in the same campaign.
create unique index if not exists outbound_initial_email_unique
  on public.outbound_email_deliveries(campaign_id, email) where kind = 'initial';
create index if not exists outbound_email_queue_idx on public.outbound_email_deliveries(status, created_at);
alter table public.outbound_email_jobs enable row level security;
alter table public.outbound_email_deliveries enable row level security;
revoke all on public.outbound_email_jobs, public.outbound_email_deliveries from anon, authenticated;
grant all on public.outbound_email_jobs, public.outbound_email_deliveries to service_role;

create or replace function public.queue_outbound_email(
  p_campaign_id uuid, p_request_key uuid, p_kind text, p_locale text,
  p_template_version text, p_template_hash text, p_subject text, p_html text,
  p_actor text, p_recipients jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare job_id uuid; recipient jsonb; inserted_count integer := 0; inserted_id uuid;
begin
  if p_kind not in ('initial','test') or jsonb_typeof(p_recipients) <> 'array'
    or jsonb_array_length(p_recipients) not between 1 and 50 then
    raise exception 'INVALID_OUTBOUND_QUEUE';
  end if;
  insert into public.outbound_email_jobs(campaign_id,request_key,kind,locale,template_version,template_hash,subject_template,html_template,requested_by)
  values(p_campaign_id,p_request_key,p_kind,p_locale,p_template_version,p_template_hash,p_subject,p_html,p_actor)
  on conflict(request_key) do nothing returning id into job_id;
  if job_id is null then
    select id into job_id from public.outbound_email_jobs where request_key = p_request_key;
    return jsonb_build_object('jobId',job_id,'duplicate',true,'queued',0);
  end if;
  for recipient in select * from jsonb_array_elements(p_recipients) loop
    inserted_id := null;
    insert into public.outbound_email_deliveries(job_id,campaign_id,prospect_id,kind,email,name,company)
    values(job_id,p_campaign_id,nullif(recipient->>'prospectId','')::uuid,p_kind,lower(btrim(recipient->>'email')),recipient->>'name',recipient->>'company')
    on conflict do nothing returning id into inserted_id;
    if inserted_id is not null then inserted_count := inserted_count + 1; end if;
  end loop;
  return jsonb_build_object('jobId',job_id,'duplicate',false,'queued',inserted_count,'alreadyQueued',jsonb_array_length(p_recipients)-inserted_count);
end; $$;

create or replace function public.claim_outbound_email(p_job_id uuid default null, p_limit integer default 10, p_campaign_id uuid default null)
returns setof public.outbound_email_deliveries language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- An interrupted send is never automatically retried: reconcile with the provider first.
  update public.outbound_email_deliveries set status='uncertain', error_message='Proses terhenti. Periksa arsip penyedia email sebelum pengiriman lain.',updated_at=now()
    where status='processing' and updated_at < now() - interval '10 minutes'
      and (p_job_id is null or job_id=p_job_id) and (p_campaign_id is null or campaign_id=p_campaign_id);
  return query
  update public.outbound_email_deliveries d set status='processing', updated_at=now()
  where d.id in (
    select q.id from public.outbound_email_deliveries q
    where q.status='queued' and (p_job_id is null or q.job_id=p_job_id) and (p_campaign_id is null or q.campaign_id=p_campaign_id)
    order by q.created_at limit greatest(1,least(p_limit,10)) for update skip locked
  ) returning d.*;
end; $$;
revoke all on function public.queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.queue_outbound_email(uuid,uuid,text,text,text,text,text,text,text,jsonb) to service_role;
revoke all on function public.claim_outbound_email(uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_outbound_email(uuid,integer,uuid) to service_role;
commit;
