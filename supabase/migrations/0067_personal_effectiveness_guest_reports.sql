-- Free-3 delivery without an account. Requires SQL 64B, 65 and 66.
-- Does not change the CEO instrument, scoring, existing permissions or paid access.
begin;
do $$ begin
  if to_regprocedure('public.pe_start_participant_v2(uuid,uuid,jsonb,text,text,text,text)') is null then
    raise exception 'PE_SQL66_REQUIRED';
  end if;
end; $$;

create table if not exists public.pe_report_snapshots (
  attempt_id uuid primary key references public.pe_participant_attempts(id) on delete cascade,
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and snapshot->>'version'='pe-development-report-v2'),
  created_at timestamptz not null default now()
);
create table if not exists public.pe_guest_contacts (
  attempt_id uuid primary key references public.pe_participant_attempts(id) on delete cascade,
  name text not null check(length(name) between 1 and 100),
  email text not null check(length(email) between 3 and 254 and email=lower(btrim(email))),
  draft_hash text not null unique check(draft_hash ~ '^[a-f0-9]{64}$'),
  draft_until timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now()
);
create table if not exists public.pe_email_links (
  id uuid primary key,
  attempt_id uuid not null references public.pe_guest_contacts(attempt_id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.pe_result_sessions (
  token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
  attempt_id uuid not null references public.pe_guest_contacts(attempt_id) on delete cascade,
  expires_at timestamptz not null default now()+interval '30 minutes'
);
create table if not exists public.pe_report_email_jobs (
  id uuid primary key references public.pe_email_links(id) on delete cascade,
  attempt_id uuid not null references public.pe_report_snapshots(attempt_id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','processing','sent','failed','uncertain')),
  attempts int not null default 0,
  available_at timestamptz not null default now(),
  first_attempt_at timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  email_from text,
  link_origin text,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists pe_report_email_pending_idx on public.pe_report_email_jobs(status,available_at);
alter table public.pe_report_email_jobs add column if not exists email_from text;
alter table public.pe_report_email_jobs add column if not exists link_origin text;
create index if not exists pe_result_sessions_attempt_idx on public.pe_result_sessions(attempt_id);
create index if not exists pe_guest_email_idx on public.pe_guest_contacts(email,created_at desc);
create table if not exists public.pe_delivery_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.pe_participant_attempts(id) on delete set null,
  event text not null check(event in ('result_opened','evaluation_export')),
  actor_id uuid,
  record_count int,
  created_at timestamptz not null default now()
);
-- Aggregate consent from SQL 66 is NOT consent for row-level evaluation exports.
alter table public.pe_review_permissions add column if not exists export_consent boolean not null default false;
alter table public.pe_review_permissions add column if not exists evaluation_version text
  check(evaluation_version is null or evaluation_version='pe-evaluation-v2');
create or replace function public.pe_clear_revoked_export() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if not new.evaluation_consent then new.export_consent:=false; end if;
  return new;
end; $$;
drop trigger if exists pe_clear_revoked_export on public.pe_review_permissions;
create trigger pe_clear_revoked_export before insert or update on public.pe_review_permissions
  for each row execute function public.pe_clear_revoked_export();
revoke all on function public.pe_clear_revoked_export() from public,anon,authenticated,service_role;

create or replace function public.pe_freeze_report(p_id uuid,p_owner uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts; r jsonb; area jsonb; score jsonb;
begin
  select * into a from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now() for update;
  if not found or a.status<>'submitted' then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select snapshot into r from public.pe_report_snapshots where attempt_id=p_id;
  if found then return r; end if;
  if p_snapshot is null or jsonb_typeof(p_snapshot)<>'object' or p_snapshot->>'version'<>'pe-development-report-v2'
    or jsonb_typeof(p_snapshot->'areas') is distinct from 'array' or jsonb_array_length(p_snapshot->'areas')<>3
    or p_snapshot->'metadata'->>'instrumentVersion' is distinct from a.result->>'instrumentVersion'
    or p_snapshot->'metadata'->>'assessmentDate' is null then raise exception 'PE_INVALID_REPORT'; end if;
  for area in select value from jsonb_array_elements(p_snapshot->'areas') loop
    select value into score from jsonb_array_elements(a.result->'competencies') where value->>'code'=area->>'code';
    if not found or area->'selfReport' is distinct from score->'selfReport' or area->'sjt' is distinct from score->'sjt' then
      raise exception 'PE_INVALID_REPORT';
    end if;
  end loop;
  if (select count(distinct value->>'code') from jsonb_array_elements(p_snapshot->'areas'))<>3 then raise exception 'PE_INVALID_REPORT'; end if;
  insert into public.pe_report_snapshots(attempt_id,snapshot) values(p_id,p_snapshot);
  return p_snapshot;
end; $$;

create or replace function public.pe_guest_attempt(p_id uuid,p_hash text,p_scope text default 'draft') returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts; r jsonb; c public.pe_guest_contacts;
begin
  if p_scope not in ('draft','result') or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select g.* into c from public.pe_guest_contacts g join public.pe_participant_attempts t on t.id=g.attempt_id
    where g.attempt_id=p_id and t.retention_until>now() and
      ((p_scope='draft' and g.draft_hash=p_hash and g.draft_until>now())
       or(p_scope='result' and exists(select 1 from public.pe_result_sessions s where s.attempt_id=p_id and s.token_hash=p_hash and s.expires_at>now())));
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select * into a from public.pe_participant_attempts where id=p_id;
  r:=public.pe_participant_dto(a);
  if p_scope='draft' then r:=jsonb_set(r,'{result}','null'); end if;
  return jsonb_build_object('attempt',r,'ownerId',a.owner_id,'name',c.name,'email',c.email,
    'report',case when p_scope='result' then (select snapshot from public.pe_report_snapshots where attempt_id=p_id) else null end,
    'emailStatus',(select status from public.pe_report_email_jobs where attempt_id=p_id order by created_at desc,id desc limit 1));
end; $$;

create or replace function public.pe_start_guest(p_id uuid,p_hash text,p_name text,p_email text,p_context jsonb,
  p_consent_version text,p_privacy_version text,p_sharing_version text,p_channel text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.pe_guest_contacts; a jsonb;
begin
  if p_id is null or p_name is null or p_email is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or length(btrim(p_name)) not between 1 and 100
    or length(p_email) not between 3 and 254 or p_email<>lower(btrim(p_email)) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'PE_INVALID_REQUEST';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into existing from public.pe_guest_contacts where attempt_id=p_id;
  if found then
    if existing.draft_hash<>p_hash or existing.email<>p_email or existing.name<>btrim(p_name) then raise exception 'PE_START_CONFLICT'; end if;
    a:=public.pe_guest_attempt(p_id,p_hash,'draft');
    if a->'attempt'->'context' is distinct from p_context then raise exception 'PE_START_CONFLICT'; end if;
    return a;
  end if;
  a:=public.pe_start_participant_v2(p_id,gen_random_uuid(),p_context,p_consent_version,p_privacy_version,p_sharing_version,p_channel);
  insert into public.pe_guest_contacts(attempt_id,name,email,draft_hash) values(p_id,btrim(p_name),p_email,p_hash);
  return public.pe_guest_attempt(p_id,p_hash,'draft');
end; $$;

create or replace function public.pe_queue_guest_report(p_id uuid,p_hash text,p_snapshot jsonb,p_link_id uuid,p_link_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare g jsonb; r jsonb;
begin
  -- Trusted recovery may queue after the seven-day draft access expires, but not after retention.
  select jsonb_build_object('ownerId',a.owner_id,'attempt',public.pe_participant_dto(a)) into g
    from public.pe_guest_contacts c join public.pe_participant_attempts a on a.id=c.attempt_id
    where a.id=p_id and c.draft_hash=p_hash and a.retention_until>now();
  if g is null then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  if g->'attempt'->>'status'<>'submitted' then raise exception 'PE_RESULT_NOT_READY'; end if;
  r:=public.pe_freeze_report(p_id,(g->>'ownerId')::uuid,p_snapshot);
  if exists(select 1 from public.pe_report_email_jobs where attempt_id=p_id) then return true; end if;
  if p_link_id is null or p_link_hash is null or p_link_hash !~ '^[a-f0-9]{64}$' then raise exception 'PE_INVALID_REQUEST'; end if;
  insert into public.pe_email_links(id,attempt_id,token_hash) values(p_link_id,p_id,p_link_hash);
  insert into public.pe_report_email_jobs(id,attempt_id) values(p_link_id,p_id);
  return true;
end; $$;

create or replace function public.pe_attach_account_contact(p_id uuid,p_owner uuid,p_name text,p_email text,p_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  -- HTTP supplies the verified account email, never a client-provided address.
  perform 1 from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now() for update;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  insert into public.pe_guest_contacts(attempt_id,name,email,draft_hash) values(p_id,p_name,p_email,p_hash) on conflict(attempt_id) do nothing;
  return true;
end; $$;

create or replace function public.pe_next_unqueued_report() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('attempt',public.pe_participant_dto(a),'draftHash',c.draft_hash)
    from public.pe_participant_attempts a join public.pe_guest_contacts c on c.attempt_id=a.id
    where a.status='submitted' and a.retention_until>now() and not exists
      (select 1 from public.pe_report_email_jobs j where j.attempt_id=a.id)
    order by a.submitted_at limit 1;
$$;

drop function if exists public.pe_claim_report_email(uuid);
create or replace function public.pe_claim_report_email(p_id uuid default null,p_from text default null,p_origin text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.pe_report_email_jobs;
begin
  -- Provider deduplication lasts 24h. Never blindly resend beyond that window.
  update public.pe_report_email_jobs set status='uncertain',lease_token=null,lease_until=null
    where status in ('pending','processing') and first_attempt_at<now()-interval '20 hours' and (lease_until is null or lease_until<now());
  select * into j from public.pe_report_email_jobs where (p_id is null or attempt_id=p_id)
    and available_at<=now() and ((status='pending' and attempts<5) or(status='processing' and lease_until<now()))
    order by created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.pe_report_email_jobs set status='processing',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()),
    email_from=coalesce(email_from,p_from),link_origin=coalesce(link_origin,p_origin),
    lease_token=gen_random_uuid(),lease_until=now()+interval '10 minutes' where id=j.id returning * into j;
  update public.pe_email_links set expires_at=coalesce(expires_at,now()+interval '48 hours') where id=j.id;
  return jsonb_build_object('id',j.id,'attemptId',j.attempt_id,'leaseToken',j.lease_token,'attempts',j.attempts,'from',j.email_from,'origin',j.link_origin,
    'name',(select name from public.pe_guest_contacts where attempt_id=j.attempt_id),
    'email',(select email from public.pe_guest_contacts where attempt_id=j.attempt_id),
    'linkHash',(select token_hash from public.pe_email_links where id=j.id),
    'snapshot',(select snapshot from public.pe_report_snapshots where attempt_id=j.attempt_id));
end; $$;

create or replace function public.pe_finish_report_email(p_id uuid,p_lease uuid,p_provider text,p_error text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.pe_report_email_jobs set status=case when p_provider is not null then 'sent' when attempts>=5 then 'failed' else 'pending' end,
    sent_at=case when p_provider is not null then now() end,provider_id=p_provider,last_error_code=p_error,
    available_at=now()+interval '1 minute',lease_until=null,lease_token=null
    where id=p_id and lease_token=p_lease and status='processing';
  return found;
end; $$;

create or replace function public.pe_exchange_email_link(p_id uuid,p_hash text,p_session_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare link public.pe_email_links;
begin
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'PE_INVALID_REQUEST'; end if;
  select l.* into link from public.pe_email_links l join public.pe_participant_attempts a on a.id=l.attempt_id
    where l.attempt_id=p_id and l.token_hash=p_hash and l.expires_at>now() and l.consumed_at is null and a.retention_until>now()
    for update of l;
  if not found then raise exception 'PE_LINK_EXPIRED'; end if;
  update public.pe_email_links set consumed_at=now() where id=link.id;
  insert into public.pe_result_sessions(token_hash,attempt_id) values(p_session_hash,p_id);
  insert into public.pe_delivery_events(attempt_id,event) values(p_id,'result_opened');
  return true;
end; $$;

create or replace function public.pe_owner_review_access(p_id uuid,p_owner uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.pe_participant_attempts where id=p_id and owner_id=p_owner and retention_until>now()) then
    raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  select jsonb_build_object('shared',r.granted_at is not null and r.revoked_at is null,
    'evaluationConsent',r.evaluation_consent,'exportConsent',r.evaluation_consent and r.export_consent,
    'clarity',f.clarity,'usefulness',f.usefulness) into result
    from public.pe_review_permissions r left join public.pe_pilot_feedback f on f.attempt_id=r.attempt_id where r.attempt_id=p_id;
  return coalesce(result,jsonb_build_object('shared',false,'evaluationConsent',false,'exportConsent',false,'clarity',null,'usefulness',null));
end; $$;

create or replace function public.pe_request_latest_result_link(p_email text,p_link_id uuid,p_hash text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid;
begin
  select a.id into v_id from public.pe_participant_attempts a join public.pe_guest_contacts c on c.attempt_id=a.id
    join public.pe_report_snapshots r on r.attempt_id=a.id where c.email=p_email and a.status='submitted' and a.retention_until>now()
    order by a.submitted_at desc,a.id desc limit 1;
  if v_id is null then return null; end if;
  if public.pe_request_result_link(v_id,p_email,p_link_id,p_hash) then return v_id; end if;
  return null;
end; $$;

create or replace function public.pe_update_review_access_v2(p_id uuid,p_owner uuid,p_share boolean,
  p_consent_version text,p_evaluate boolean,p_clarity int,p_usefulness int,p_evaluation_version text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_evaluation_version is distinct from 'pe-evaluation-v2' then raise exception 'PE_CONSENT_REQUIRED'; end if;
  perform public.pe_update_review_access(p_id,p_owner,p_share,p_consent_version,p_evaluate,p_clarity,p_usefulness);
  update public.pe_review_permissions set export_consent=p_evaluate,evaluation_version=p_evaluation_version where attempt_id=p_id;
  return public.pe_owner_review_access(p_id,p_owner);
end; $$;

-- HTTP requires admin authentication first. No identities, contact/context, keys, or rationales.
-- Deduplicate latest submissions per owner; guest owners represent attempts, not verified people.
create or replace function public.pe_export_evaluation(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; n int;
begin
  if p_actor is null then raise exception 'PE_INVALID_REQUEST'; end if;
  with latest as (
    select distinct on(owner_id) * from public.pe_participant_attempts
      where status='submitted' and retention_until>now() order by owner_id,submitted_at desc,id desc
  ), eligible as (
    select a.* from latest a join public.pe_review_permissions r on r.attempt_id=a.id
      where r.evaluation_consent and r.export_consent and r.evaluation_version='pe-evaluation-v2'
      order by a.submitted_at desc limit 1001
  ) select jsonb_agg(jsonb_build_object('instrumentVersion',eligible.result->>'instrumentVersion',
    'scoringVersion',eligible.result->>'scoringVersion','responses',responses,'competencies',eligible.result->'competencies',
    'elapsedSeconds',greatest(0,extract(epoch from submitted_at-created_at)::int),
    'clarity',(select clarity from public.pe_pilot_feedback where attempt_id=eligible.id),
    'usefulness',(select usefulness from public.pe_pilot_feedback where attempt_id=eligible.id))) into result from eligible;
  n:=coalesce(jsonb_array_length(result),0);
  if n<5 then raise exception 'PE_EVALUATION_SAMPLE_SMALL'; end if;
  if n>1000 then raise exception 'PE_EXPORT_LIMIT'; end if;
  insert into public.pe_delivery_events(event,actor_id,record_count) values('evaluation_export',p_actor,n);
  return result;
end; $$;

create or replace function public.pe_cleanup_result_sessions() returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n int;
begin
  delete from public.pe_result_sessions where expires_at<=now();get diagnostics n=row_count;
  return n;
end; $$;

create or replace function public.pe_request_result_link(p_id uuid,p_email text,p_link_id uuid,p_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.pe_guest_contacts g join public.pe_participant_attempts a on a.id=g.attempt_id
    join public.pe_report_snapshots r on r.attempt_id=a.id where a.id=p_id and a.status='submitted' and a.retention_until>now() and g.email=p_email) then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  if exists(select 1 from public.pe_report_email_jobs where attempt_id=p_id and created_at>now()-interval '10 minutes') then return false; end if;
  insert into public.pe_email_links(id,attempt_id,token_hash) values(p_link_id,p_id,p_hash);
  insert into public.pe_report_email_jobs(id,attempt_id) values(p_link_id,p_id);
  return true;
end; $$;

alter table public.pe_report_snapshots enable row level security;
alter table public.pe_guest_contacts enable row level security;
alter table public.pe_email_links enable row level security;
alter table public.pe_result_sessions enable row level security;
alter table public.pe_report_email_jobs enable row level security;
alter table public.pe_delivery_events enable row level security;
revoke all on public.pe_delivery_events from public,anon,authenticated,service_role;
grant select on public.pe_delivery_events to service_role;
revoke all on public.pe_report_snapshots,public.pe_guest_contacts,public.pe_email_links,public.pe_result_sessions,public.pe_report_email_jobs from public,anon,authenticated,service_role;
grant select on public.pe_report_snapshots,public.pe_guest_contacts,public.pe_email_links,public.pe_result_sessions,public.pe_report_email_jobs to service_role;
revoke all on function public.pe_freeze_report(uuid,uuid,jsonb),public.pe_guest_attempt(uuid,text,text),
  public.pe_start_guest(uuid,text,text,text,jsonb,text,text,text,text),public.pe_queue_guest_report(uuid,text,jsonb,uuid,text),
  public.pe_claim_report_email(uuid,text,text),public.pe_finish_report_email(uuid,uuid,text,text),
  public.pe_exchange_email_link(uuid,text,text),public.pe_request_result_link(uuid,text,uuid,text),
  public.pe_update_review_access_v2(uuid,uuid,boolean,text,boolean,int,int,text),public.pe_export_evaluation(uuid),
  public.pe_cleanup_result_sessions(),public.pe_attach_account_contact(uuid,uuid,text,text,text),
  public.pe_next_unqueued_report(),public.pe_request_latest_result_link(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.pe_freeze_report(uuid,uuid,jsonb),public.pe_guest_attempt(uuid,text,text),
  public.pe_start_guest(uuid,text,text,text,jsonb,text,text,text,text),public.pe_queue_guest_report(uuid,text,jsonb,uuid,text),
  public.pe_claim_report_email(uuid,text,text),public.pe_finish_report_email(uuid,uuid,text,text),
  public.pe_exchange_email_link(uuid,text,text),public.pe_request_result_link(uuid,text,uuid,text),
  public.pe_update_review_access_v2(uuid,uuid,boolean,text,boolean,int,int,text),public.pe_export_evaluation(uuid),
  public.pe_cleanup_result_sessions(),public.pe_attach_account_contact(uuid,uuid,text,text,text),
  public.pe_next_unqueued_report(),public.pe_request_latest_result_link(text,uuid,text) to service_role;
commit;
