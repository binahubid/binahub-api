-- SQL76: isolated PETA pilot. No changes to PE/RM/SPIN/TBOS or existing records.
-- Source installed separately as encrypted SQL76B. RPCs are service-role only.
begin;
create table if not exists public.peta_instruments (
 instrument_id text not null, version text not null, public_payload jsonb not null,
 sealed_key jsonb not null, key_fingerprint text not null check(key_fingerprint~'^[a-f0-9]{64}$'),
 public_sha256 text not null check(public_sha256~'^[a-f0-9]{64}$'), created_at timestamptz not null default now(),
 primary key(instrument_id,version),check(instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot')
);
create table if not exists public.peta_workspaces (
 id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 100),
 owner_id uuid not null, consultant_id uuid, privacy_reference text not null check(length(privacy_reference) between 10 and 500),
 approved_at timestamptz not null default now(),retention_months int not null default 12 check(retention_months=12),
 enabled boolean not null default true,created_at timestamptz not null default now()
);
create table if not exists public.peta_invitations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.peta_workspaces,
 token_hash text not null unique check(token_hash~'^[a-f0-9]{64}$'),participant_code text not null check(participant_code~'^[A-Za-z0-9_-]{1,64}$'),
 purpose text not null default 'start' check(purpose in ('start','resume')), session_id uuid,
 expires_at timestamptz not null,redeemed_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.peta_sessions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.peta_workspaces,
 invitation_id uuid not null unique references public.peta_invitations,
 instrument_id text not null default 'PETA-DISC-FC24',instrument_version text not null default '1.0.0-pilot',
 participant_code text not null,status text not null default 'in_progress' check(status in ('in_progress','submitted','revoked')),
 revision int not null default 0 check(revision>=0),consent_version text not null,consented_at timestamptz not null default now(),
 review_consent boolean not null default false,consultant_id uuid,privacy_reference text not null,
 retention_until timestamptz not null default(now()+interval '1 year'),created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),submitted_at timestamptz,submission_hash text,
 unique(id,workspace_id),foreign key(instrument_id,instrument_version) references public.peta_instruments,
 check((status='submitted' and submitted_at is not null and submission_hash is not null) or status<>'submitted')
);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='peta_invitation_session_scope') then
  alter table public.peta_invitations add constraint peta_invitation_session_scope foreign key(session_id,workspace_id) references public.peta_sessions(id,workspace_id) on delete cascade;
 end if;
end $$;
create table if not exists public.peta_credentials (
 token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),session_id uuid not null references public.peta_sessions on delete cascade,
 csrf_hash text not null check(csrf_hash~'^[a-f0-9]{64}$'),expires_at timestamptz not null,last_seen_at timestamptz not null default now()
);
create table if not exists public.peta_answers (
 session_id uuid not null references public.peta_sessions on delete cascade,block_id text not null check(block_id~'^PETA-Q(0[1-9]|1[0-9]|2[0-4])$'),
 most text check(most in ('A','B','C','D')),least text check(least in ('A','B','C','D')),
 check(most is null or least is null or most<>least),primary key(session_id,block_id)
);
create table if not exists public.peta_results (
 session_id uuid primary key references public.peta_sessions on delete cascade,result jsonb not null,quality_flags jsonb not null,
 calculated_at timestamptz not null default now()
);
create table if not exists public.peta_access_audit (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.peta_workspaces,
 session_id uuid references public.peta_sessions on delete set null,actor_id uuid,event text not null,
 created_at timestamptz not null default now()
);
create index if not exists peta_sessions_workspace_idx on public.peta_sessions(workspace_id,created_at desc);
create index if not exists peta_sessions_retention_idx on public.peta_sessions(retention_until);
create index if not exists peta_invitations_workspace_idx on public.peta_invitations(workspace_id,created_at desc);
create index if not exists peta_credentials_expiry_idx on public.peta_credentials(expires_at);
create index if not exists peta_audit_workspace_idx on public.peta_access_audit(workspace_id,created_at desc);

create or replace function public.peta_source_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'PETA_SOURCE_IMMUTABLE';end $$;
drop trigger if exists peta_source_immutable on public.peta_instruments;
create trigger peta_source_immutable before update or delete on public.peta_instruments for each row execute function public.peta_source_immutable();
create or replace function public.peta_install_source(p_public jsonb,p_sealed jsonb,p_key_fingerprint text,p_public_hash text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare existing public.peta_instruments;
begin
 if p_public->>'instrumentId'<>'PETA-DISC-FC24' or p_public->>'version'<>'1.0.0-pilot' or jsonb_array_length(p_public->'blocks')<>24
  or p_public->>'contentSha256' is distinct from p_public_hash or p_sealed->>'algorithm' is distinct from 'A256GCM' then raise exception 'PETA_SOURCE_INVALID';end if;
 select * into existing from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot';
 if found then
  if existing.public_payload<>p_public or existing.key_fingerprint<>p_key_fingerprint or existing.sealed_key<>p_sealed then raise exception 'PETA_SOURCE_IMMUTABLE';end if;
  return true;
 end if;
 insert into public.peta_instruments values('PETA-DISC-FC24','1.0.0-pilot',p_public,p_sealed,p_key_fingerprint,p_public_hash,now());return true;
end $$;

create or replace function public.peta_score_v1(p_public jsonb,p_key jsonb,p_fingerprint text,p_answers jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public as $$
declare b jsonb;a jsonb;k jsonb;d text;chosen text;code text;fingerprint text;pattern text;patterns text[]:='{}';
 mosts jsonb:='{"D":0,"I":0,"S":0,"C":0}';leasts jsonb:='{"D":0,"I":0,"S":0,"C":0}';nets jsonb:='{}';
 rows jsonb:='[]';tops jsonb;top_value int;second_value int;quality jsonb:='[]';last_pair text;run int:=0;longest int:=0;
 position_m jsonb:='{"A":0,"B":0,"C":0,"D":0}';position_l jsonb:='{"A":0,"B":0,"C":0,"D":0}';
begin
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or (select count(*) from jsonb_object_keys(p_answers))<>24 then raise exception 'PETA_INCOMPLETE';end if;
 if jsonb_typeof(p_key) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_key))<>24 then raise exception 'PETA_SOURCE_INVALID';end if;
 select encode(sha256(convert_to(string_agg(key||':'||(value->>'A')||(value->>'B')||(value->>'C')||(value->>'D'),'|' order by key),'UTF8')),'hex') into fingerprint from jsonb_each(p_key);
 if fingerprint is distinct from p_fingerprint then raise exception 'PETA_SOURCE_INVALID';end if;
 for b in select value from jsonb_array_elements(p_public->'blocks') order by (value->>'order')::int loop
  k:=p_key->(b->>'id');a:=p_answers->(b->>'id');
  if a is null or a->>'most' is null or a->>'least' is null then raise exception 'PETA_INCOMPLETE';end if;
  if a->>'most' not in ('A','B','C','D') or a->>'least' not in ('A','B','C','D') or a->>'most'=a->>'least' then raise exception 'PETA_INVALID_ANSWER';end if;
  if (select string_agg(value,'' order by value) from jsonb_each_text(k)) is distinct from 'CDIS' then raise exception 'PETA_SOURCE_INVALID';end if;
  pattern:=(k->>'A')||(k->>'B')||(k->>'C')||(k->>'D');patterns:=array_append(patterns,pattern);
  d:=k->>(a->>'most');mosts:=jsonb_set(mosts,array[d],to_jsonb((mosts->>d)::int+1));
  d:=k->>(a->>'least');leasts:=jsonb_set(leasts,array[d],to_jsonb((leasts->>d)::int+1));
  code:=a->>'most';position_m:=jsonb_set(position_m,array[code],to_jsonb((position_m->>code)::int+1));
  code:=a->>'least';position_l:=jsonb_set(position_l,array[code],to_jsonb((position_l->>code)::int+1));
  chosen:=(a->>'most')||':'||(a->>'least');run:=case when chosen=last_pair then run+1 else 1 end;last_pair:=chosen;longest:=greatest(longest,run);
 end loop;
 if (select count(distinct value) from unnest(patterns) as value)<>24 then raise exception 'PETA_SOURCE_INVALID';end if;
 foreach d in array array['D','I','S','C'] loop
  nets:=nets||jsonb_build_object(d,(mosts->>d)::int-(leasts->>d)::int);
  rows:=rows||jsonb_build_array(jsonb_build_object('dimension',d,'most',(mosts->>d)::int,'least',(leasts->>d)::int,'net',(mosts->>d)::int-(leasts->>d)::int));
 end loop;
 if (select sum(value::int) from jsonb_each_text(mosts))<>24 or (select sum(value::int) from jsonb_each_text(leasts))<>24 or (select sum(value::int) from jsonb_each_text(nets))<>0 then raise exception 'PETA_SOURCE_INVALID';end if;
 select value::int into top_value from jsonb_each_text(nets) order by value::int desc limit 1;
 select value::int into second_value from jsonb_each_text(nets) order by value::int desc offset 1 limit 1;
 select jsonb_agg(dimension order by ord) into tops from unnest(array['D','I','S','C']) with ordinality x(dimension,ord) where (nets->>dimension)::int=top_value;
 if longest>=6 then quality:=quality||jsonb_build_array(jsonb_build_object('code','REPEATED_PAIR_RUN','value',longest,'severity','review_only'));end if;
 if exists(select 1 from jsonb_each_text(position_m||'{}'::jsonb) where value::int>=13) or exists(select 1 from jsonb_each_text(position_l) where value::int>=13) then quality:=quality||jsonb_build_array(jsonb_build_object('code','POSITION_CONCENTRATION','severity','review_only'));end if;
 return jsonb_build_object('instrumentVersion','1.0.0-pilot','method','forced_choice_most_least_net_v1','rows',rows,'topDimensions',tops,
  'topIsTied',jsonb_array_length(tops)>1,'closeTopScores',top_value-second_value<=2,'qualityFlags',quality);
end $$;

create or replace function public.peta_session_auth(p_hash text,p_csrf text default null) returns public.peta_sessions
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.peta_credentials;s public.peta_sessions;
begin
 select * into c from public.peta_credentials where token_hash=p_hash and expires_at>now() and last_seen_at>now()-interval '30 minutes';
 if not found or (p_csrf is not null and c.csrf_hash<>p_csrf) then raise exception 'PETA_SESSION_REQUIRED';end if;
 select * into s from public.peta_sessions where id=c.session_id and status<>'revoked' and retention_until>now();
 if not found then raise exception 'PETA_SESSION_REQUIRED';end if;
 update public.peta_credentials set last_seen_at=now() where token_hash=p_hash;return s;
end $$;
create or replace function public.peta_session_dto(s public.peta_sessions) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
select jsonb_build_object('id',s.id,'status',s.status,'revision',s.revision,'participantCode',s.participant_code,
 'instrumentVersion',s.instrument_version,'retentionUntil',s.retention_until,'submittedAt',s.submitted_at,
 'reviewConsent',s.review_consent,'privacyReference',s.privacy_reference,'consentVersion',s.consent_version,
 'blocks',(select public_payload->'blocks' from public.peta_instruments where instrument_id=s.instrument_id and version=s.instrument_version),
 'answers',coalesce((select jsonb_object_agg(block_id,jsonb_build_object('most',most,'least',least)) from public.peta_answers where session_id=s.id),'{}'::jsonb));
$$;
create or replace function public.peta_workspace_create(p_actor uuid,p_name text,p_reference text,p_consultant boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare new_id uuid;
begin
 if p_actor is null or nullif(btrim(p_name),'') is null or length(btrim(p_reference))<10 then raise exception 'PETA_INVALID_REQUEST';end if;
 insert into public.peta_workspaces(name,owner_id,consultant_id,privacy_reference)
 values(btrim(p_name),p_actor,case when p_consultant then p_actor end,btrim(p_reference)) returning id into new_id;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(new_id,p_actor,'workspace_approved');return new_id;
end $$;
create or replace function public.peta_invitation_create(p_actor uuid,p_workspace uuid,p_hash text,p_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;i public.peta_invitations;
begin
 select * into w from public.peta_workspaces where id=p_workspace and owner_id=p_actor and enabled;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 if not exists(select 1 from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot') then raise exception 'PETA_SETUP_REQUIRED';end if;
 insert into public.peta_invitations(workspace_id,token_hash,participant_code,expires_at) values(w.id,p_hash,p_code,now()+interval '7 days') returning * into i;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w.id,p_actor,'invitation_created');
 return jsonb_build_object('id',i.id,'expiresAt',i.expires_at);
end $$;
create or replace function public.peta_invitation_info(p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.peta_invitations;w public.peta_workspaces;
begin
 select * into i from public.peta_invitations where token_hash=p_hash and expires_at>now() and redeemed_at is null and revoked_at is null;
 if not found then raise exception 'PETA_LINK_EXPIRED';end if;
 select * into w from public.peta_workspaces where id=i.workspace_id and enabled;
 if not found then raise exception 'PETA_LINK_EXPIRED';end if;
 if i.purpose='resume' and not exists(select 1 from public.peta_sessions where id=i.session_id and workspace_id=i.workspace_id and status<>'revoked' and retention_until>now()) then raise exception 'PETA_LINK_EXPIRED';end if;
 return jsonb_build_object('workspaceName',w.name,'privacyReference',w.privacy_reference,'retentionMonths',12,
  'consultantAccess',w.consultant_id is not null,'consentVersion','peta-privacy-v1','purpose',i.purpose,'expiresAt',i.expires_at);
end $$;
create or replace function public.peta_redeem(p_hash text,p_credential text,p_csrf text,p_consent_version text,p_review_consent boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.peta_invitations;w public.peta_workspaces;s public.peta_sessions;
begin
 select * into i from public.peta_invitations where token_hash=p_hash for update;
 if not found or i.expires_at<=now() or i.redeemed_at is not null or i.revoked_at is not null then raise exception 'PETA_LINK_EXPIRED';end if;
 select * into w from public.peta_workspaces where id=i.workspace_id and enabled;
 if not found or p_consent_version is distinct from 'peta-privacy-v1' then raise exception 'PETA_CONSENT_REQUIRED';end if;
 if i.purpose='start' then
  if not exists(select 1 from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot') then raise exception 'PETA_SETUP_REQUIRED';end if;
  insert into public.peta_sessions(workspace_id,invitation_id,participant_code,consent_version,review_consent,consultant_id,privacy_reference)
   values(w.id,i.id,i.participant_code,p_consent_version,coalesce(p_review_consent,false) and w.consultant_id is not null,w.consultant_id,w.privacy_reference) returning * into s;
  update public.peta_invitations set session_id=s.id where id=i.id;
 else
  select * into s from public.peta_sessions where id=i.session_id and workspace_id=w.id and status<>'revoked' and retention_until>now() for update;
  if not found then raise exception 'PETA_LINK_EXPIRED';end if;
  delete from public.peta_credentials where session_id=s.id;
 end if;
 update public.peta_invitations set redeemed_at=now() where id=i.id;
 insert into public.peta_credentials(token_hash,session_id,csrf_hash,expires_at) values(p_credential,s.id,p_csrf,least(now()+interval '8 hours',s.retention_until));
 insert into public.peta_access_audit(workspace_id,session_id,event) values(w.id,s.id,case when i.purpose='start' then 'consented' else 'access_recovered' end);
 return public.peta_session_dto(s);
end $$;
create or replace function public.peta_read_session(p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;begin s:=public.peta_session_auth(p_hash);return public.peta_session_dto(s);end $$;
create or replace function public.peta_save_answer(p_hash text,p_csrf text,p_revision int,p_block text,p_most text,p_least text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;
begin
 s:=public.peta_session_auth(p_hash,p_csrf);
 select * into s from public.peta_sessions where id=s.id for update;
 if s.status<>'in_progress' then raise exception 'PETA_FINALIZED';end if;
 if p_revision is null or s.revision<>p_revision then raise exception 'PETA_REVISION_CONFLICT';end if;
 if p_block is null or p_block!~'^PETA-Q(0[1-9]|1[0-9]|2[0-4])$' or (p_most is not null and p_most not in ('A','B','C','D')) or (p_least is not null and p_least not in ('A','B','C','D')) or (p_most is not null and p_most=p_least) then raise exception 'PETA_INVALID_ANSWER';end if;
 insert into public.peta_answers values(s.id,p_block,p_most,p_least) on conflict(session_id,block_id) do update set most=excluded.most,least=excluded.least;
 update public.peta_sessions set revision=revision+1,updated_at=now() where id=s.id returning * into s;
 return public.peta_session_dto(s);
end $$;
create or replace function public.peta_submit(p_hash text,p_csrf text,p_revision int,p_submission text,p_key jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;source public.peta_instruments;answers jsonb;scored jsonb;
begin
 s:=public.peta_session_auth(p_hash,p_csrf);select * into s from public.peta_sessions where id=s.id for update;
 if s.status='submitted' then
  if s.submission_hash=p_submission then return jsonb_build_object('status','submitted','submittedAt',s.submitted_at);end if;
  raise exception 'PETA_FINALIZED';
 end if;
 if p_revision is null or s.revision<>p_revision then raise exception 'PETA_REVISION_CONFLICT';end if;
 if p_submission is null or p_submission!~'^[a-f0-9]{64}$' then raise exception 'PETA_INVALID_REQUEST';end if;
 select * into strict source from public.peta_instruments where instrument_id=s.instrument_id and version=s.instrument_version;
 select jsonb_object_agg(block_id,jsonb_build_object('most',most,'least',least)) into answers from public.peta_answers where session_id=s.id;
 scored:=public.peta_score_v1(source.public_payload,p_key,source.key_fingerprint,answers);
 insert into public.peta_results(session_id,result,quality_flags) values(s.id,scored-'qualityFlags',scored->'qualityFlags');
 update public.peta_sessions set status='submitted',submission_hash=p_submission,submitted_at=now(),updated_at=now(),revision=revision+1 where id=s.id returning * into s;
 insert into public.peta_access_audit(workspace_id,session_id,event) values(s.workspace_id,s.id,'submitted');
 return jsonb_build_object('status','submitted','submittedAt',s.submitted_at);
end $$;
create or replace function public.peta_read_result(p_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;r jsonb;
begin
 s:=public.peta_session_auth(p_hash);if s.status<>'submitted' then raise exception 'PETA_RESULT_NOT_READY';end if;
 select result into strict r from public.peta_results where session_id=s.id;
 insert into public.peta_access_audit(workspace_id,session_id,event) values(s.workspace_id,s.id,'participant_result_opened');
 return jsonb_build_object('result',r,'participantCode',s.participant_code,'submittedAt',s.submitted_at,'retentionUntil',s.retention_until);
end $$;
create or replace function public.peta_admin_dashboard(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_actor is null then raise exception 'PETA_NOT_FOUND';end if;
 return jsonb_build_object('sourceReady',exists(select 1 from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot'),
  'workspaces',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'consultantAccess',consultant_id is not null,'privacyReference',privacy_reference) order by created_at desc) from public.peta_workspaces where owner_id=p_actor),'[]'::jsonb),
  'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'workspaceId',i.workspace_id,'participantCode',i.participant_code,'purpose',i.purpose,'expiresAt',i.expires_at,'status',case when i.revoked_at is not null then 'revoked' when i.redeemed_at is not null then 'used' when i.expires_at<=now() then 'expired' else 'invited' end) order by i.created_at desc) from (select i.* from public.peta_invitations i join public.peta_workspaces w on w.id=i.workspace_id where w.owner_id=p_actor order by i.created_at desc limit 100)i),'[]'::jsonb),
  'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'workspaceId',s.workspace_id,'participantCode',s.participant_code,'status',case when s.retention_until<=now() then 'expired' else s.status end,'revision',s.revision,'completedBlocks',(select count(*) from public.peta_answers where session_id=s.id and most is not null and least is not null),'submittedAt',s.submitted_at,'retentionUntil',s.retention_until,'instrumentVersion',s.instrument_version,'consentVersion',s.consent_version,'consentedAt',s.consented_at,'reviewConsent',s.review_consent,'canReadResult',s.review_consent and s.consultant_id=p_actor and s.status='submitted' and s.retention_until>now()) order by s.created_at desc) from (select s.* from public.peta_sessions s join public.peta_workspaces w on w.id=s.workspace_id where w.owner_id=p_actor order by s.created_at desc limit 100)s),'[]'::jsonb),
  'audit',coalesce((select jsonb_agg(jsonb_build_object('id',a.id::text,'workspaceId',a.workspace_id,'participantCode',s.participant_code,'event',a.event,'createdAt',a.created_at,'adminAction',a.actor_id is not null) order by a.created_at desc,a.id desc) from (select a.* from public.peta_access_audit a join public.peta_workspaces w on w.id=a.workspace_id where w.owner_id=p_actor order by a.created_at desc,a.id desc limit 100)a left join public.peta_sessions s on s.id=a.session_id),'[]'::jsonb));
end $$;
create or replace function public.peta_admin_action(p_actor uuid,p_id uuid,p_action text,p_hash text default null,p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;w public.peta_workspaces;r jsonb;expiry timestamptz;
begin
 select s0.* into s from public.peta_sessions s0 join public.peta_workspaces w0 on w0.id=s0.workspace_id where s0.id=p_id and w0.owner_id=p_actor for update of s0;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 select * into strict w from public.peta_workspaces where id=s.workspace_id;
 if p_action='result' then
  if s.status<>'submitted' or s.retention_until<=now() or not s.review_consent or s.consultant_id is distinct from p_actor then raise exception 'PETA_NOT_FOUND';end if;
  select result into strict r from public.peta_results where session_id=s.id;
  insert into public.peta_access_audit(workspace_id,session_id,actor_id,event) values(w.id,s.id,p_actor,'consultant_result_opened');
  return jsonb_build_object('result',r,'participantCode',s.participant_code,'submittedAt',s.submitted_at,'retentionUntil',s.retention_until);
 elsif p_action='recover' then
  if not p_verified or s.status='revoked' or s.retention_until<=now() or p_hash is null then raise exception 'PETA_INVALID_REQUEST';end if;
  update public.peta_invitations set revoked_at=now() where session_id=s.id and redeemed_at is null and revoked_at is null;
  expiry:=least(now()+interval '30 minutes',s.retention_until);
  insert into public.peta_invitations(workspace_id,token_hash,participant_code,purpose,session_id,expires_at) values(w.id,p_hash,s.participant_code,'resume',s.id,expiry);
  insert into public.peta_access_audit(workspace_id,session_id,actor_id,event) values(w.id,s.id,p_actor,'recovery_issued_after_verification');return jsonb_build_object('expiresAt',expiry);
 elsif p_action='revoke' then
  update public.peta_sessions set status='revoked',updated_at=now() where id=s.id;
  delete from public.peta_credentials where session_id=s.id;update public.peta_invitations set revoked_at=now() where session_id=s.id and revoked_at is null;
 elsif p_action='erase' then
  if not p_verified then raise exception 'PETA_INVALID_REQUEST';end if;
  -- FK removes answers, results, credentials and associated invitations; audit loses session link.
  delete from public.peta_sessions where id=s.id;
 else raise exception 'PETA_INVALID_REQUEST';end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w.id,p_actor,p_action);return jsonb_build_object('done',true);
end $$;
create or replace function public.peta_revoke_invitation(p_actor uuid,p_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w_id uuid;
begin
 update public.peta_invitations i set revoked_at=now() from public.peta_workspaces w where i.id=p_id and w.id=i.workspace_id and w.owner_id=p_actor and i.redeemed_at is null and i.revoked_at is null returning w.id into w_id;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w_id,p_actor,'invitation_revoked');return true;
end $$;
create or replace function public.peta_purge_expired(p_limit int default 100) returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s record;n int:=0;
begin
 if p_limit is null or p_limit not between 1 and 1000 then raise exception 'PETA_INVALID_REQUEST';end if;
 for s in select id,workspace_id from public.peta_sessions where retention_until<=now() order by retention_until limit p_limit for update skip locked loop
  delete from public.peta_sessions where id=s.id;insert into public.peta_access_audit(workspace_id,event) values(s.workspace_id,'retention_erased');n:=n+1;
 end loop;
 delete from public.peta_credentials where expires_at<=now();
 delete from public.peta_invitations where session_id is null and expires_at<now()-interval '1 year';
 delete from public.peta_access_audit where created_at<now()-interval '1 year';return n;
end $$;

-- Finalized responses/results cannot be edited directly, including by service clients.
create or replace function public.peta_answer_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.peta_sessions where id=coalesce(new.session_id,old.session_id) and status<>'in_progress') then raise exception 'PETA_FINALIZED';end if;return new;
end $$;
drop trigger if exists peta_answer_immutable on public.peta_answers;
create trigger peta_answer_immutable before insert or update on public.peta_answers for each row execute function public.peta_answer_immutable();
drop trigger if exists peta_result_immutable on public.peta_results;
create trigger peta_result_immutable before update on public.peta_results for each row execute function public.peta_source_immutable();
do $$ declare t text;f record;begin
 foreach t in array array['peta_instruments','peta_workspaces','peta_invitations','peta_sessions','peta_credentials','peta_answers','peta_results','peta_access_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 -- Backend may read only the encrypted source. Every other operation goes through scoped RPCs.
 grant select on public.peta_instruments to service_role;
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'peta\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in ('peta_install_source','peta_workspace_create','peta_invitation_create','peta_invitation_info','peta_redeem','peta_read_session','peta_save_answer','peta_submit','peta_read_result','peta_admin_dashboard','peta_admin_action','peta_revoke_invitation','peta_purge_expired') then execute format('grant execute on function %s to service_role',f.signature);end if;
 end loop;
end $$;
commit;
