-- SQL 98. Associate referral attribution in the BinaHub API database.
-- Run after 0097. Existing submissions and opportunity stages are preserved.
begin;

create table if not exists public.associate_referral_codes (
  associate_id uuid primary key,
  code text unique not null check (code ~ '^BH-[0-9A-F]{10}$'),
  email_key text not null check (email_key ~ '^[0-9a-f]{64}$'),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.associate_referral_visits (
  id uuid primary key default gen_random_uuid(),
  associate_id uuid not null references public.associate_referral_codes(associate_id),
  code text not null,
  method text not null check (method in ('link', 'manual')),
  journey_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists associate_referral_visits_asg_idx on public.associate_referral_visits(associate_id);
create index if not exists associate_referral_visits_journey_idx on public.associate_referral_visits(journey_id, created_at);

create table if not exists public.associate_referral_cases (
  id uuid primary key default gen_random_uuid(),
  email_key text unique not null check (email_key ~ '^[0-9a-f]{64}$'),
  associate_id uuid references public.associate_referral_codes(associate_id),
  lead_id uuid references public.leads(id) on delete cascade,
  review_status text not null check (review_status in ('pending', 'verified', 'rejected')),
  review_reason text check (review_reason in ('manual', 'existing_contact', 'existing_organization', 'conflict', 'booking_without_code', 'self_referral')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists associate_referral_cases_associate_idx on public.associate_referral_cases(associate_id, updated_at desc);

create table if not exists public.associate_referral_entries (
  case_id uuid not null references public.associate_referral_cases(id) on delete cascade,
  source text not null check (source in ('recommendation', 'team_diagnosis', 'individual_diagnosis', 'inquiry', 'booking')),
  source_ref text not null check (length(source_ref) between 1 and 256),
  visit_id uuid references public.associate_referral_visits(id),
  claimed_associate_id uuid references public.associate_referral_codes(associate_id),
  can_share_contact boolean not null default false,
  individual_attempt_id uuid references public.pe_guest_contacts(attempt_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (source, source_ref)
);
create index if not exists associate_referral_entries_case_idx on public.associate_referral_entries(case_id, created_at);
create index if not exists associate_referral_entries_individual_idx on public.associate_referral_entries(individual_attempt_id)
  where individual_attempt_id is not null;

create table if not exists public.associate_referral_booking_tokens (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.associate_referral_visits(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '1 day'),
  booking_series text
);

create table if not exists public.associate_referral_follow_ups (
  id uuid primary key,
  case_id uuid not null references public.associate_referral_cases(id) on delete cascade,
  associate_id uuid not null references public.associate_referral_codes(associate_id),
  note text not null check (length(note) <= 1000),
  revisit_on date,
  help_requested boolean not null default false,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists associate_referral_follow_ups_case_idx
  on public.associate_referral_follow_ups(case_id, associate_id, created_at desc);

create table if not exists public.associate_referral_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.associate_referral_cases(id) on delete cascade,
  reviewer_id uuid not null,
  previous_associate_id uuid,
  associate_id uuid,
  status text not null check (status in ('verified', 'rejected')),
  reason text not null check (length(reason) between 3 and 500),
  created_at timestamptz not null default now()
);
create index if not exists associate_referral_reviews_case_idx on public.associate_referral_reviews(case_id, created_at desc);

alter table public.inquiries add column if not exists referral_visit_id uuid references public.associate_referral_visits(id);
alter table public.inquiries add column if not exists referral_contact_consent boolean not null default false;
alter table public.assessments add column if not exists referral_visit_id uuid references public.associate_referral_visits(id);
alter table public.assessments add column if not exists referral_contact_consent boolean not null default false;
alter table public.pe_guest_contacts add column if not exists referral_visit_id uuid references public.associate_referral_visits(id);
alter table public.pe_guest_contacts add column if not exists referral_contact_consent boolean not null default false;

alter table public.associate_referral_codes enable row level security;
alter table public.associate_referral_visits enable row level security;
alter table public.associate_referral_cases enable row level security;
alter table public.associate_referral_entries enable row level security;
alter table public.associate_referral_booking_tokens enable row level security;
alter table public.associate_referral_follow_ups enable row level security;
alter table public.associate_referral_reviews enable row level security;

revoke all on public.associate_referral_codes, public.associate_referral_visits, public.associate_referral_cases,
  public.associate_referral_entries, public.associate_referral_booking_tokens, public.associate_referral_follow_ups,
  public.associate_referral_reviews from public, anon, authenticated, service_role;

create or replace function public.referral_email_key(p_email text)
returns text language sql immutable strict set search_path=pg_catalog as $$
  select encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex');
$$;

create or replace function public.referral_code_settings(p_associate uuid, p_email text, p_action text, p_expected_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare settings public.associate_referral_codes;
begin
  if p_associate is null or nullif(btrim(p_email), '') is null or p_action not in ('load','enable','disable','rotate') then
    raise exception 'REFERRAL_INVALID';
  end if;
  insert into public.associate_referral_codes(associate_id,code,email_key)
  values(p_associate,'BH-'||upper(left(replace(gen_random_uuid()::text,'-',''),10)),public.referral_email_key(p_email))
  on conflict(associate_id) do update set email_key=excluded.email_key
    where associate_referral_codes.email_key is distinct from excluded.email_key;

  select * into strict settings from public.associate_referral_codes where associate_id=p_associate for update;
  if p_action <> 'load' and settings.code is distinct from p_expected_code then raise exception 'REFERRAL_CODE_CHANGED'; end if;
  if p_action = 'rotate' then
    update public.associate_referral_codes set code='BH-'||upper(left(replace(gen_random_uuid()::text,'-',''),10))
      where associate_id=p_associate returning * into settings;
  elsif p_action in ('enable','disable') then
    update public.associate_referral_codes set enabled=(p_action='enable')
      where associate_id=p_associate returning * into settings;
  end if;
  return jsonb_build_object('code',settings.code,'enabled',settings.enabled);
end;
$$;

create or replace function public.referral_lookup(p_visit uuid, p_code text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('associateId',c.associate_id,'code',c.code,
    'visitId',v.id,'expiresAt',v.expires_at,'method',v.method)
  from public.associate_referral_codes c
  left join public.associate_referral_visits v on v.id=p_visit and v.associate_id=c.associate_id
    and v.code=c.code and v.expires_at>now()
  where c.enabled and (v.id is not null or (p_visit is null and c.code=p_code))
  limit 1;
$$;

create or replace function public.referral_register_visit(p_code text, p_method text, p_journey uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.associate_referral_visits; owner uuid;
begin
  select associate_id into owner from public.associate_referral_codes where enabled and code=p_code for share;
  if not found then return null; end if;
  insert into public.associate_referral_visits(associate_id,code,method,journey_id)
    values(owner,p_code,p_method,p_journey) returning * into saved;
  return public.referral_lookup(saved.id,null);
end;
$$;

create or replace function public.referral_issue_booking_token(p_visit uuid)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare token uuid;
begin
  if public.referral_lookup(p_visit,null) is null then return null; end if;
  insert into public.associate_referral_booking_tokens(visit_id) values(p_visit) returning id into token;
  return token;
end;
$$;

create or replace function public.referral_record_entry(
  p_visit uuid, p_lead uuid, p_source text, p_reference text, p_email text, p_company text,
  p_share boolean, p_individual uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  visit public.associate_referral_visits;
  code public.associate_referral_codes;
  ref public.associate_referral_cases;
  lead public.leads;
  needed_review text;
  email_key_value text;
begin
  if nullif(btrim(p_email),'') is null or p_reference is null then return; end if;
  email_key_value:=public.referral_email_key(p_email);
  if p_visit is not null then
    select v.* into visit from public.associate_referral_visits v
      join public.associate_referral_codes c on c.associate_id=v.associate_id and c.enabled and c.code=v.code
      where v.id=p_visit and v.expires_at>now() for share of c;
    if found then
      select * into code from public.associate_referral_codes where associate_id=visit.associate_id;
    end if;
  end if;
  if code.associate_id is null and p_source <> 'booking'
     and not exists(select 1 from public.associate_referral_cases c where c.email_key=email_key_value) then return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(email_key_value,9855));
  if exists(select 1 from public.associate_referral_entries where source=p_source and source_ref=p_reference) then return; end if;
  if p_lead is not null then
    select * into lead from public.leads where id=p_lead;
  else
    select * into lead from public.leads where email=lower(btrim(p_email)) limit 1;
  end if;
  select * into ref from public.associate_referral_cases c where c.email_key=email_key_value for update;

  if ref.id is null or (ref.associate_id is null and code.associate_id is not null and ref.review_status='pending') then
    needed_review:=case
      when code.associate_id is null then 'booking_without_code'
      when code.email_key=email_key_value then 'self_referral'
      when lead.created_at<visit.created_at and (ref.id is null or ref.lead_id is distinct from lead.id) then 'existing_contact'
      when nullif(btrim(p_company),'') is not null and exists(
        select 1 from public.leads l where lower(btrim(l.company))=lower(btrim(p_company))
          and l.id is distinct from lead.id and l.opportunity_stage in ('consultation','proposal','negotiation','won')
      ) then 'existing_organization'
      when visit.method='manual' then 'manual'
    end;
    if ref.id is null then
      insert into public.associate_referral_cases(email_key,associate_id,lead_id,review_status,review_reason)
        values(email_key_value,code.associate_id,lead.id,case when needed_review is null then 'verified' else 'pending' end,needed_review)
        returning * into ref;
    else
      update public.associate_referral_cases as c set associate_id=code.associate_id,lead_id=coalesce(c.lead_id,lead.id),
        review_status='pending',review_reason=coalesce(needed_review,'booking_without_code'),updated_at=now()
        where id=ref.id returning * into ref;
    end if;
  else
    update public.associate_referral_cases as c set lead_id=coalesce(c.lead_id,lead.id),
      review_reason=case when code.associate_id is not null and code.associate_id<>ref.associate_id
        and review_status<>'rejected' then 'conflict' else review_reason end,updated_at=now()
      where id=ref.id returning * into ref;
  end if;

  insert into public.associate_referral_entries(case_id,source,source_ref,visit_id,claimed_associate_id,
    can_share_contact,individual_attempt_id)
  values(ref.id,p_source,p_reference,visit.id,code.associate_id,
    coalesce(p_share and code.email_key<>email_key_value,false),p_individual)
  on conflict(source,source_ref) do nothing;
end;
$$;

create or replace function public.referral_capture_intake() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  guest public.pe_guest_contacts;
  inquiry public.inquiries;
  token text;
  visit uuid;
begin
  if TG_TABLE_NAME='inquiries' then
    if new.source in ('spin_discovery','individual_consultation') then return new; end if;
    perform public.referral_record_entry(new.referral_visit_id,new.lead_id,'inquiry',new.id::text,
      new.email,new.company,new.referral_contact_consent,null);
  elsif TG_TABLE_NAME='assessments' then
    if new.program_id is null then
      perform public.referral_record_entry(new.referral_visit_id,new.lead_id,'team_diagnosis',new.id::text,
        new.form_data->>'email',new.form_data->>'company',new.referral_contact_consent,null);
    end if;
  elsif TG_TABLE_NAME='pe_participant_attempts' then
    if old.status<>'submitted' and new.status='submitted' then
      select * into guest from public.pe_guest_contacts where attempt_id=new.id;
      if found then
        perform public.referral_record_entry(guest.referral_visit_id,null,'individual_diagnosis',new.id::text,
          guest.email,null,guest.referral_contact_consent,new.id);
      end if;
    end if;
  elsif TG_TABLE_NAME='pe_consultation_requests' then
    select * into inquiry from public.inquiries where id=new.inquiry_id;
    if found then
      perform public.referral_record_entry(null,inquiry.lead_id,'inquiry',inquiry.id::text,inquiry.email,null,false,null);
    end if;
  elsif TG_TABLE_NAME='calendar_bookings' then
    if new.provider <> 'cal.com' or new.status not in ('requested','confirmed','rescheduled') then return new; end if;
    token:=coalesce(new.provider_payload->'metadata'->>'binahub_referral',
      new.provider_payload->'responses'->'binahub_referral'->>'value');
    if token ~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' then
      update public.associate_referral_booking_tokens set booking_series=coalesce(new.provider_series_uid,new.provider_uid)
        where id=token::uuid and expires_at>now()
          and (booking_series is null or booking_series=coalesce(new.provider_series_uid,new.provider_uid))
        returning visit_id into visit;
    end if;
    perform public.referral_record_entry(visit,new.lead_id,'booking',coalesce(new.provider_series_uid,new.provider_uid),
      new.attendee_email,null,false,null);
  end if;
  return new;
end;
$$;

drop trigger if exists referral_capture_inquiry on public.inquiries;
create trigger referral_capture_inquiry after insert on public.inquiries
for each row execute function public.referral_capture_intake();
drop trigger if exists referral_capture_team on public.assessments;
create trigger referral_capture_team after insert on public.assessments
for each row execute function public.referral_capture_intake();
drop trigger if exists referral_capture_individual on public.pe_participant_attempts;
create trigger referral_capture_individual after update of status on public.pe_participant_attempts
for each row execute function public.referral_capture_intake();
drop trigger if exists referral_capture_individual_consultation on public.pe_consultation_requests;
create trigger referral_capture_individual_consultation after insert on public.pe_consultation_requests
for each row execute function public.referral_capture_intake();
drop trigger if exists referral_capture_booking on public.calendar_bookings;
create trigger referral_capture_booking after insert or update of status, provider_payload on public.calendar_bookings
for each row execute function public.referral_capture_intake();

create or replace function public.referral_cleanup_individual() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if old.individual_attempt_id is not null then
    delete from public.associate_referral_cases c where c.id=old.case_id
      and not exists(select 1 from public.associate_referral_entries e where e.case_id=old.case_id);
  end if;
  return old;
end;
$$;
drop trigger if exists referral_cleanup_individual on public.associate_referral_entries;
create trigger referral_cleanup_individual after delete on public.associate_referral_entries
for each row execute function public.referral_cleanup_individual();

create or replace function public.referral_prepare_individual(p_id uuid,p_hash text,p_visit uuid,p_share boolean)
returns void language sql security definer set search_path=pg_catalog,public as $$
  update public.pe_guest_contacts set referral_visit_id=p_visit,referral_contact_consent=coalesce(p_share,false)
  where attempt_id=p_id and draft_hash=p_hash and referral_visit_id is null
    and public.referral_lookup(p_visit,null) is not null
    and exists(select 1 from public.pe_participant_attempts where id=p_id and status='draft');
$$;

create or replace function public.referral_spin_write(
  p_id uuid,p_hash text,p_revision int,p_answers jsonb,p_confirmation jsonb,p_summary jsonb,p_submit jsonb,
  p_visit uuid,p_share boolean
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; submission public.spin_submissions; was_draft boolean;
begin
  select status='draft' into was_draft from public.spin_submissions where id=p_id and draft_hash=p_hash for update;
  result:=public.spin_write(p_id,p_hash,p_revision,p_answers,p_confirmation,p_summary,p_submit);
  if was_draft and p_submit is not null then
    select * into strict submission from public.spin_submissions where id=p_id;
    perform public.referral_record_entry(p_visit,submission.lead_id,'recommendation',p_id::text,
      submission.contact->>'email',submission.contact->>'company',p_share,null);
  end if;
  return result;
end;
$$;

create or replace function public.referral_add_follow_up(
  p_associate uuid,p_case uuid,p_id uuid,p_note text,p_revisit date,p_help boolean
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_id is null or length(coalesce(p_note,''))>1000
    or (nullif(btrim(p_note),'') is null and p_revisit is null and not coalesce(p_help,false))
  then raise exception 'REFERRAL_INVALID'; end if;
  if not exists(select 1 from public.associate_referral_cases c left join public.leads l on l.id=c.lead_id
    where c.id=p_case and c.associate_id=p_associate and c.review_status<>'rejected'
      and l.opportunity_stage is distinct from 'lost' for share of c) then raise exception 'REFERRAL_NOT_FOUND'; end if;
  if exists(select 1 from public.associate_referral_follow_ups where id=p_id and case_id=p_case and associate_id=p_associate) then return; end if;
  if p_revisit is not null and p_revisit < (now() at time zone 'Asia/Jakarta')::date then raise exception 'REFERRAL_INVALID'; end if;
  if (nullif(btrim(p_note),'') is not null or p_revisit is not null) and not exists(
    select 1 from public.associate_referral_cases c join public.associate_referral_entries e on e.case_id=c.id
      left join public.pe_participant_attempts a on a.id=e.individual_attempt_id
    where c.id=p_case and c.review_status='verified' and e.claimed_associate_id=p_associate and e.can_share_contact
      and (e.individual_attempt_id is null or a.retention_until>now())
  ) then raise exception 'REFERRAL_CONSENT_REQUIRED'; end if;
  insert into public.associate_referral_follow_ups(id,case_id,associate_id,note,revisit_on,help_requested)
  values(p_id,p_case,p_associate,coalesce(btrim(p_note),''),p_revisit,coalesce(p_help,false))
  on conflict(id) do nothing;
end;
$$;

create or replace function public.referral_review(
  p_admin uuid,p_case uuid,p_status text,p_code text,p_reason text,p_expected_at timestamptz
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare ref public.associate_referral_cases; owner public.associate_referral_codes;
begin
  if p_status not in ('verified','rejected') or coalesce(length(btrim(p_reason)),0) not between 3 and 500 or p_admin is null
    then raise exception 'REFERRAL_INVALID'; end if;
  select * into ref from public.associate_referral_cases where id=p_case for update;
  if not found then raise exception 'REFERRAL_NOT_FOUND'; end if;
  if ref.updated_at is distinct from p_expected_at then raise exception 'REFERRAL_CHANGED'; end if;
  if p_status='verified' then
    select * into owner from public.associate_referral_codes c
      where case when p_code is not null then c.code=p_code else c.associate_id=ref.associate_id end and c.enabled;
    if owner.associate_id is null then raise exception 'REFERRAL_CODE_INVALID'; end if;
    if owner.email_key=ref.email_key then raise exception 'REFERRAL_SELF'; end if;
  end if;
  update public.associate_referral_cases
    set associate_id=coalesce(owner.associate_id,ref.associate_id),review_status=p_status,review_reason=null,updated_at=now()
    where id=p_case;
  insert into public.associate_referral_reviews(case_id,reviewer_id,previous_associate_id,associate_id,status,reason)
    values(p_case,p_admin,ref.associate_id,coalesce(owner.associate_id,ref.associate_id),p_status,btrim(p_reason));
  update public.associate_referral_follow_ups set resolved_at=now() where case_id=p_case and help_requested and resolved_at is null;
end;
$$;

create or replace function public.referral_dashboard(
  p_associate uuid,p_admin boolean,p_status text,p_source text,p_owner uuid,p_offset int,p_limit int
) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
with cases as (
  select c.*, l.name, l.company, l.email, l.opportunity_stage, l.next_action,
    case
      when c.review_status='rejected' or l.opportunity_stage='lost' then 'closed'
      when c.review_status='pending' then 'incoming'
      when l.opportunity_stage='won' and (l.lifecycle_stage='retained'
        or exists(select 1 from public.consultant_workspaces w where w.lead_id=c.lead_id and w.handoff is not null)) then 'completed'
      when l.opportunity_stage='won' then 'won'
      when l.opportunity_stage in ('consultation','proposal','negotiation') then 'in_progress'
      else 'verified'
    end as stage,
    exists(select 1 from public.associate_referral_follow_ups f where f.case_id=c.id
      and f.associate_id=c.associate_id and f.help_requested and f.resolved_at is null) as help_requested
  from public.associate_referral_cases c left join public.leads l on l.id=c.lead_id
  where (p_admin is true or c.associate_id=p_associate)
    and (p_owner is null or not p_admin or c.associate_id=p_owner)
    and (p_source is null or exists(select 1 from public.associate_referral_entries e where e.case_id=c.id and e.source=p_source))
), filtered as (
  select c.* from cases c
  where (p_status is null or p_status=c.stage or p_status='success' and c.stage in ('won','completed')
     or p_status='review' and (c.review_status='pending' or c.review_reason is not null or c.help_requested))
), page as (
  select c.* from filtered c order by c.updated_at desc,c.id
  offset greatest(coalesce(p_offset,0),0) limit greatest(1,least(coalesce(p_limit,20),50))
)
select jsonb_build_object(
  'totals',(select jsonb_build_object(
    'visits',(select count(*) from public.associate_referral_visits v
      where p_admin is true and (p_owner is null or v.associate_id=p_owner) or v.associate_id=p_associate),
    'incoming',count(*) filter(where stage='incoming'),
    'verified',count(*) filter(where stage='verified'),
    'inProgress',count(*) filter(where stage='in_progress'),
    'successful',count(*) filter(where stage in ('won','completed')),
    'review',count(*) filter(where review_status='pending' or review_reason is not null or help_requested)
  ) from cases),
  'total',(select count(*) from filtered),
  'records',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'stage',c.stage,'reviewStatus',c.review_status,'needsHelp',c.help_requested,
    'createdAt',c.created_at,'updatedAt',c.updated_at,
    'company',case when p_admin or c.review_status='verified' then nullif(c.company,'') end,
    'canShareContact',c.review_status='verified' and consent.allowed,
    'associateCode',case when p_admin then (select code from public.associate_referral_codes a where a.associate_id=c.associate_id) end,
    'contact',case when (p_admin or c.review_status='verified' and consent.allowed)
      and coalesce(c.email,guests.email) is not null then
      jsonb_build_object('name',coalesce(c.name,guests.name),'email',coalesce(c.email,guests.email)) end,
    'nextAction',case when p_admin then c.next_action end,
    'leadId',case when p_admin then c.lead_id end,
    'opportunityStage',case when p_admin then c.opportunity_stage end,
    'associateId',case when p_admin then c.associate_id end,
    'reviewReason',case when p_admin then c.review_reason end,
    'sources',coalesce(hist.entries,'[]'::jsonb),
    'followUps',coalesce(notes.entries,'[]'::jsonb),
    'reviews',case when p_admin then coalesce(audit.entries,'[]'::jsonb) end
   ) order by c.updated_at desc,c.id)
  from page c
  left join lateral (
    select exists(select 1 from public.associate_referral_entries e
      left join public.pe_participant_attempts a on a.id=e.individual_attempt_id
      where e.case_id=c.id and e.claimed_associate_id=c.associate_id and e.can_share_contact
        and (e.individual_attempt_id is null or a.retention_until>now())) allowed
  ) consent on true
  left join lateral (
    select g.name,g.email from public.associate_referral_entries e
      join public.pe_guest_contacts g on g.attempt_id=e.individual_attempt_id
      join public.pe_participant_attempts a on a.id=g.attempt_id and a.status='submitted' and a.retention_until>now()
      where e.case_id=c.id and e.can_share_contact and (p_admin or e.claimed_associate_id=c.associate_id)
      order by e.created_at desc limit 1
  ) guests on c.lead_id is null
  left join lateral (
    select jsonb_agg(jsonb_build_object('channel',e.source,'at',e.created_at,
      'claimedAssociateId',case when p_admin then e.claimed_associate_id end,
      'reference',case when p_admin then e.source_ref end) order by e.created_at,e.source,e.source_ref) entries
    from (select * from public.associate_referral_entries where case_id=c.id order by created_at,source,source_ref limit 30) e
  ) hist on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('note',f.note,'revisitOn',f.revisit_on,'requestedHelp',f.help_requested,
      'resolvedAt',f.resolved_at,'at',f.created_at) order by f.created_at desc) entries
    from (select * from public.associate_referral_follow_ups
      where case_id=c.id and associate_id=c.associate_id and (not p_admin or help_requested)
      order by created_at desc limit 5) f
  ) notes on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('status',v.status,'reason',v.reason,'at',v.created_at,
      'previousAssociateId',v.previous_associate_id,'associateId',v.associate_id) order by v.created_at desc) entries
    from (select * from public.associate_referral_reviews where case_id=c.id and p_admin
      order by created_at desc limit 10) v
  ) audit on true
  ),'[]'::jsonb),
  'associates',case when p_admin then coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.associate_id,'code',a.code,'enabled',a.enabled,
    'visits',(select count(*) from public.associate_referral_visits v where v.associate_id=a.associate_id),
    'referrals',(select count(*) from public.associate_referral_cases r where r.associate_id=a.associate_id),
    'meetings',(select count(*) from public.associate_referral_cases r join public.leads l on l.id=r.lead_id
      where r.associate_id=a.associate_id and r.review_status='verified' and l.opportunity_stage in ('consultation','proposal','negotiation','won')),
    'proposals',(select count(*) from public.associate_referral_cases r join public.leads l on l.id=r.lead_id
      where r.associate_id=a.associate_id and r.review_status='verified' and l.opportunity_stage in ('proposal','negotiation','won')),
    'won',(select count(*) from public.associate_referral_cases r join public.leads l on l.id=r.lead_id
      where r.associate_id=a.associate_id and r.review_status='verified' and l.opportunity_stage='won')
  ) order by a.created_at desc) from public.associate_referral_codes a),'[]'::jsonb) end
);
$$;

revoke all on function public.referral_email_key(text), public.referral_code_settings(uuid,text,text,text),
  public.referral_lookup(uuid,text), public.referral_register_visit(text,text,uuid), public.referral_issue_booking_token(uuid),
  public.referral_record_entry(uuid,uuid,text,text,text,text,boolean,uuid), public.referral_capture_intake(),
  public.referral_cleanup_individual(), public.referral_prepare_individual(uuid,text,uuid,boolean),
  public.referral_spin_write(uuid,text,int,jsonb,jsonb,jsonb,jsonb,uuid,boolean),
  public.referral_add_follow_up(uuid,uuid,uuid,text,date,boolean),
  public.referral_review(uuid,uuid,text,text,text,timestamptz),
  public.referral_dashboard(uuid,boolean,text,text,uuid,int,int)
from public,anon,authenticated,service_role;

grant execute on function public.referral_code_settings(uuid,text,text,text), public.referral_lookup(uuid,text),
  public.referral_register_visit(text,text,uuid),public.referral_issue_booking_token(uuid),
  public.referral_prepare_individual(uuid,text,uuid,boolean), public.referral_spin_write(uuid,text,int,jsonb,jsonb,jsonb,jsonb,uuid,boolean),
  public.referral_add_follow_up(uuid,uuid,uuid,text,date,boolean), public.referral_review(uuid,uuid,text,text,text,timestamptz),
  public.referral_dashboard(uuid,boolean,text,text,uuid,int,int)
to service_role;

notify pgrst, 'reload schema';
commit;
