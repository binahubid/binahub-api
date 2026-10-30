-- SQL77: PETA as a program module. SQL76 + encrypted SQL76B remain prerequisites.
-- Additive only: no operational cleanup, automatic relinking, scoring or source change.
begin;
do $$ begin
 if to_regclass('public.peta_sessions') is null or to_regclass('public.program_modules') is null
  or to_regclass('public.app_client_access_codes') is null then raise exception 'PETA_SETUP_REQUIRED';end if;
end $$;
alter table public.program_modules drop constraint if exists program_modules_module_key_check;
alter table public.program_modules add constraint program_modules_module_key_check
 check(module_key in ('tbos','lep','binainsight','pre_test','post_test','peta'));
alter table public.peta_workspaces add column if not exists program_id uuid references public.engagements(id);
create unique index if not exists peta_workspace_program_idx on public.peta_workspaces(program_id) where program_id is not null;
alter table public.peta_sessions add column if not exists program_id uuid references public.engagements(id);
alter table public.peta_sessions add column if not exists participant_id uuid references public.participants(id);
alter table public.peta_sessions add column if not exists program_access_id uuid references public.app_client_access_codes(id);
alter table public.peta_sessions drop constraint if exists peta_program_scope_required;
alter table public.peta_sessions add constraint peta_program_scope_required check(
 (program_id is null and participant_id is null and program_access_id is null)
 or (program_id is not null and participant_id is not null and program_access_id is not null));
create unique index if not exists peta_session_program_participant_idx on public.peta_sessions(program_id,participant_id) where program_id is not null;

create or replace function public.peta_program_access(p_actor uuid,p_program uuid,p_participant uuid,p_access uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.app_client_access_codes a
 join public.engagements e on e.id=a.program_id
 join public.engagement_participants ep on ep.engagement_id=e.id and ep.participant_id=a.participant_id
 join public.program_modules m on m.program_id=e.id and m.module_key='peta' and m.enabled
 where a.id=p_access and a.auth_user_id=p_actor and a.program_id=p_program and a.participant_id=p_participant
 and a.is_active and (a.expires_at is null or a.expires_at>now())
 and e.status in ('active','in_progress','review')
 and (e.end_date is null or e.end_date >= (now() at time zone 'Asia/Jakarta')::date));
$$;
create or replace function public.peta_program_setup(p_actor uuid,p_program uuid,p_reference text,p_consultant boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;title text;
begin
 if p_actor is null or length(btrim(p_reference)) not between 10 and 500 then raise exception 'PETA_INVALID_REQUEST';end if;
 select e.title into title from public.engagements e join public.program_modules m on m.program_id=e.id and m.module_key='peta' and m.enabled where e.id=p_program;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_program::text,0));
 select * into w from public.peta_workspaces where program_id=p_program;
 if found then
  if w.owner_id is distinct from p_actor then raise exception 'PETA_NOT_FOUND';end if;
  -- Existing session consent/consultant/retention snapshots are never rewritten.
  update public.peta_workspaces set privacy_reference=btrim(p_reference),consultant_id=case when p_consultant then p_actor end,enabled=true where id=w.id returning * into w;
 else
  insert into public.peta_workspaces(name,owner_id,consultant_id,privacy_reference,program_id)
   values(left(title,100),p_actor,case when p_consultant then p_actor end,btrim(p_reference),p_program) returning * into w;
 end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w.id,p_actor,'program_configured');
 return w.id;
end $$;
create or replace function public.peta_program_context(p_actor uuid,p_program uuid,p_participant uuid,p_access uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;s public.peta_sessions;
begin
 if not public.peta_program_access(p_actor,p_program,p_participant,p_access) then raise exception 'PETA_NOT_FOUND';end if;
 select * into w from public.peta_workspaces where program_id=p_program and enabled;
 if not found then raise exception 'PETA_SETUP_REQUIRED';end if;
 select * into s from public.peta_sessions where program_id=p_program and participant_id=p_participant;
 if found and (s.status='revoked' or s.retention_until<=now()) then raise exception 'PETA_FINALIZED';end if;
 return jsonb_build_object('hasSession',s.id is not null,'status',s.status,'invitation',jsonb_build_object(
  'workspaceName',w.name,'retentionMonths',12,'consultantAccess',w.consultant_id is not null,
  'consentVersion','peta-program-privacy-v1','purpose','start','expiresAt',null));
end $$;
create or replace function public.peta_program_open(p_actor uuid,p_program uuid,p_participant uuid,p_access uuid,
 p_credential text,p_csrf text,p_invitation text,p_consent_version text default null,p_review_consent boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;s public.peta_sessions;i_id uuid;code text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_program::text||':'||p_participant::text,0));
 if not public.peta_program_access(p_actor,p_program,p_participant,p_access) then raise exception 'PETA_NOT_FOUND';end if;
 select * into w from public.peta_workspaces where program_id=p_program and enabled;
 if not found then raise exception 'PETA_SETUP_REQUIRED';end if;
 select * into s from public.peta_sessions where program_id=p_program and participant_id=p_participant for update;
 if found then
  if s.status='revoked' or s.retention_until<=now() or s.program_access_id is distinct from p_access then raise exception 'PETA_FINALIZED';end if;
 else
  if p_consent_version is distinct from 'peta-program-privacy-v1' then raise exception 'PETA_CONSENT_REQUIRED';end if;
  if not exists(select 1 from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot') then raise exception 'PETA_SETUP_REQUIRED';end if;
  code:='PETA-'||replace(p_participant::text,'-','');
  -- Internal grant only: no shared QR contains a participant/result credential.
  insert into public.peta_invitations(workspace_id,token_hash,participant_code,expires_at,redeemed_at)
   values(w.id,p_invitation,code,now()+interval '1 minute',now()) returning id into i_id;
  insert into public.peta_sessions(workspace_id,invitation_id,participant_code,consent_version,review_consent,consultant_id,privacy_reference,program_id,participant_id,program_access_id)
   values(w.id,i_id,code,p_consent_version,p_review_consent and w.consultant_id is not null,w.consultant_id,w.privacy_reference,p_program,p_participant,p_access) returning * into s;
  update public.peta_invitations set session_id=s.id where id=i_id;
  insert into public.peta_access_audit(workspace_id,session_id,event) values(w.id,s.id,'consented');
 end if;
 delete from public.peta_credentials where session_id=s.id;
 insert into public.peta_credentials(token_hash,session_id,csrf_hash,expires_at)
  values(p_credential,s.id,p_csrf,least(now()+interval '8 hours',s.retention_until));
 insert into public.peta_access_audit(workspace_id,session_id,event) values(w.id,s.id,'program_access_opened');
 return public.peta_session_dto(s);
end $$;

create or replace function public.peta_session_auth(p_hash text,p_csrf text default null) returns public.peta_sessions
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.peta_credentials;s public.peta_sessions;actor uuid;
begin
 select * into c from public.peta_credentials where token_hash=p_hash and expires_at>now() and last_seen_at>now()-interval '30 minutes';
 if not found or (p_csrf is not null and c.csrf_hash<>p_csrf) then raise exception 'PETA_SESSION_REQUIRED';end if;
 select * into s from public.peta_sessions where id=c.session_id and status<>'revoked' and retention_until>now();
 if not found then raise exception 'PETA_SESSION_REQUIRED';end if;
 if s.program_id is not null then
  select auth_user_id into actor from public.app_client_access_codes where id=s.program_access_id;
  if actor is null or not public.peta_program_access(actor,s.program_id,s.participant_id,s.program_access_id) then raise exception 'PETA_SESSION_REQUIRED';end if;
  if not exists(select 1 from public.peta_workspaces where id=s.workspace_id and program_id=s.program_id and enabled) then raise exception 'PETA_SESSION_REQUIRED';end if;
 end if;
 update public.peta_credentials set last_seen_at=now() where token_hash=p_hash;return s;
end $$;
create or replace function public.peta_credential_scope(p_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;begin
 s:=public.peta_session_auth(p_hash);
 return jsonb_build_object('programId',s.program_id,'participantId',s.participant_id,'accessId',s.program_access_id);
end $$;

create or replace function public.peta_program_dashboard(p_actor uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;ws jsonb;ss jsonb;
begin
 result:=public.peta_admin_dashboard(p_actor);
 select coalesce(jsonb_agg(value||jsonb_build_object('programId',w.program_id,'programCode',e.code,'programStatus',e.status) order by w.created_at desc),'[]'::jsonb)
 into ws from jsonb_array_elements(result->'workspaces') value
 join public.peta_workspaces w on w.id=(value->>'id')::uuid left join public.engagements e on e.id=w.program_id;
 select coalesce(jsonb_agg(value||jsonb_build_object('programId',s.program_id,'participantName',p.name) order by s.created_at desc),'[]'::jsonb)
 into ss from jsonb_array_elements(result->'sessions') value
 join public.peta_sessions s on s.id=(value->>'id')::uuid left join public.participants p on p.id=s.participant_id;
 return result||jsonb_build_object('workspaces',ws,'sessions',ss);
end $$;
create or replace function public.peta_program_session_binding() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare program uuid;begin
 select program_id into program from public.peta_workspaces where id=new.workspace_id;
 if new.program_id is distinct from program then raise exception 'PETA_INVALID_REQUEST';end if;
 return new;
end $$;
drop trigger if exists peta_program_session_binding on public.peta_sessions;
create trigger peta_program_session_binding before insert or update on public.peta_sessions
 for each row execute function public.peta_program_session_binding();
create or replace function public.peta_legacy_invitation_create(p_actor uuid,p_workspace uuid,p_hash text,p_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not exists(select 1 from public.peta_workspaces where id=p_workspace and owner_id=p_actor and program_id is null) then raise exception 'PETA_NOT_FOUND';end if;
 return public.peta_invitation_create(p_actor,p_workspace,p_hash,p_code);
end $$;
create or replace function public.peta_program_admin_action(p_actor uuid,p_id uuid,p_action text,p_hash text default null,p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_action='recover' and exists(select 1 from public.peta_sessions where id=p_id and program_id is not null) then raise exception 'PETA_INVALID_REQUEST';end if;
 return public.peta_admin_action(p_actor,p_id,p_action,p_hash,p_verified);
end $$;
-- New operations are backend-only; helper functions are never browser-callable.
revoke all on function public.peta_program_access(uuid,uuid,uuid,uuid),public.peta_program_setup(uuid,uuid,text,boolean),
 public.peta_program_context(uuid,uuid,uuid,uuid),public.peta_program_open(uuid,uuid,uuid,uuid,text,text,text,text,boolean),
 public.peta_credential_scope(text),public.peta_program_dashboard(uuid),public.peta_program_session_binding(),
 public.peta_legacy_invitation_create(uuid,uuid,text,text),public.peta_program_admin_action(uuid,uuid,text,text,boolean)
 from public,anon,authenticated,service_role;
grant execute on function public.peta_program_setup(uuid,uuid,text,boolean),public.peta_program_context(uuid,uuid,uuid,uuid),
 public.peta_program_open(uuid,uuid,uuid,uuid,text,text,text,text,boolean),public.peta_credential_scope(text),
 public.peta_program_dashboard(uuid),public.peta_legacy_invitation_create(uuid,uuid,text,text),
 public.peta_program_admin_action(uuid,uuid,text,text,boolean) to service_role;
commit;
