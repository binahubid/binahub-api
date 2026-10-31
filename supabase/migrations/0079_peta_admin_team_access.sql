-- SQL79: PETA is managed by the BinaHub admin team, not one workspace creator.
-- Requires SQL76, SQL77 and SQL78. Safe to rerun; no participant rows are rewritten.
-- These RPCs are SERVICE-ROLE ONLY. The API MUST call requireAdmin before passing
-- the verified actor ID. Never expose p_actor or a service key to the browser.
begin;

create or replace function public.peta_team_dashboard(p_actor uuid,p_workspace uuid default null,
 p_scope text default 'active',p_page integer default 0,p_search text default '',p_status text default 'all')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare programs jsonb; workspaces jsonb; sessions jsonb; invitations jsonb; audit jsonb;
 scope_ids uuid[]; total bigint; counts jsonb; needle text;
begin
 if p_actor is null or p_scope is null or p_scope not in ('active','history','all') or p_page is null or p_page<0 or p_page>100000
  or p_search is null or length(p_search)>150 or p_status is null or p_status not in ('all','in_progress','submitted','revoked','expired')
 then raise exception 'PETA_INVALID_REQUEST';end if;
 if p_workspace is not null and not exists(select 1 from public.peta_workspaces where id=p_workspace)
 then raise exception 'PETA_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'code',e.code,'status',e.status,'petaEnabled',true)
  order by e.title,e.id),'[]'::jsonb) into programs from public.engagements e
 where e.status in ('active','in_progress') and (e.end_date is null or e.end_date>=(now() at time zone 'Asia/Jakarta')::date)
 and exists(select 1 from public.program_modules m where m.program_id=e.id and m.module_key='peta' and m.enabled);
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'name',coalesce(e.title,w.name),
  'programId',w.program_id,'programCode',e.code,'programStatus',e.status,
  'consultantAccess',w.consultant_id is not null,'privacyReference',w.privacy_reference) order by w.created_at desc,w.id),'[]'::jsonb)
 into workspaces from public.peta_workspaces w left join public.engagements e on e.id=w.program_id;
 select coalesce(array_agg(w.id),'{}'::uuid[]) into scope_ids from public.peta_workspaces w
 where (p_workspace is null or w.id=p_workspace)
 and (p_scope='all' or (p_scope='active')=exists(select 1 from jsonb_array_elements(programs) p where (p->>'id')::uuid=w.program_id));
 select jsonb_build_object('total',count(*),'inProgress',count(*) filter(where status='in_progress' and retention_until>now()),
  'submitted',count(*) filter(where status='submitted' and retention_until>now())) into counts
 from public.peta_sessions where workspace_id=any(scope_ids);
 needle:=lower(trim(p_search));
 select count(*) into total from public.peta_sessions s left join public.participants p on p.id=s.participant_id
 where s.workspace_id=any(scope_ids)
 and (p_status='all' or p_status=case when s.retention_until<=now() then 'expired' else s.status end)
 and (needle='' or strpos(lower(coalesce(p.name,'')||' '||s.participant_code),needle)>0);
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'workspaceId',s.workspace_id,'programId',s.program_id,
  'participantName',p.name,'participantCode',s.participant_code,
  'status',case when s.retention_until<=now() then 'expired' else s.status end,
  'completedBlocks',(select count(*) from public.peta_answers where session_id=s.id and most is not null and least is not null),
  'submittedAt',s.submitted_at,'retentionUntil',s.retention_until,'instrumentVersion',s.instrument_version,
  'consentVersion',s.consent_version,'consentedAt',s.consented_at,'reviewConsent',s.review_consent,
  'canReadResult',coalesce(s.review_consent and s.consultant_id is not null and s.status='submitted' and s.retention_until>now(),false))
  order by s.created_at desc,s.id desc),'[]'::jsonb) into sessions from (
   select s.* from public.peta_sessions s left join public.participants p on p.id=s.participant_id
   where s.workspace_id=any(scope_ids)
   and (p_status='all' or p_status=case when s.retention_until<=now() then 'expired' else s.status end)
   and (needle='' or strpos(lower(coalesce(p.name,'')||' '||s.participant_code),needle)>0)
   order by s.created_at desc,s.id desc limit 20 offset p_page*20
  ) s left join public.participants p on p.id=s.participant_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'workspaceId',i.workspace_id,'participantCode',i.participant_code,
  'purpose',i.purpose,'expiresAt',i.expires_at,'status',case when i.revoked_at is not null then 'revoked'
   when i.redeemed_at is not null then 'used' when i.expires_at<=now() then 'expired' else 'invited' end)
  order by i.created_at desc,i.id),'[]'::jsonb) into invitations
 from (select * from public.peta_invitations where workspace_id=any(scope_ids) order by created_at desc,id limit 100)i;
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'workspaceId',a.workspace_id,'participantCode',s.participant_code,
  'event',a.event,'createdAt',a.created_at,'adminAction',a.actor_id is not null) order by a.created_at desc,a.id desc),'[]'::jsonb)
 into audit from (select * from public.peta_access_audit where workspace_id=any(scope_ids) order by created_at desc,id desc limit 100)a
 left join public.peta_sessions s on s.id=a.session_id;
 return jsonb_build_object('programs',programs,'workspaces',workspaces,'sessions',sessions,'invitations',invitations,'audit',audit,
  'counts',counts,'total',total,'page',p_page,'pageSize',20);
end $$;

create or replace function public.peta_team_program_setup(p_actor uuid,p_program uuid,p_reference text,p_consultant boolean)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;title text;
begin
 if p_actor is null or p_reference is null or length(btrim(p_reference)) not between 10 and 500 or p_consultant is null
 then raise exception 'PETA_INVALID_REQUEST';end if;
 select e.title into title from public.engagements e join public.program_modules m on m.program_id=e.id and m.module_key='peta' and m.enabled where e.id=p_program;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_program::text,0));
 select * into w from public.peta_workspaces where program_id=p_program;
 if found then
  -- Keep creator provenance and existing session consent/consultant snapshots.
  update public.peta_workspaces set privacy_reference=btrim(p_reference),
   consultant_id=case when p_consultant then coalesce(consultant_id,p_actor) end,enabled=true where id=w.id returning * into w;
 else
  insert into public.peta_workspaces(name,owner_id,consultant_id,privacy_reference,program_id)
   values(left(title,100),p_actor,case when p_consultant then p_actor end,btrim(p_reference),p_program) returning * into w;
 end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w.id,p_actor,'program_configured');
 return w.id;
end $$;

create or replace function public.peta_team_session_action(p_actor uuid,p_id uuid,p_action text,p_hash text default null,p_verified boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.peta_sessions;r jsonb;expiry timestamptz;
begin
 if p_actor is null then raise exception 'PETA_NOT_FOUND';end if;
 select * into s from public.peta_sessions where id=p_id for update;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 if p_action='result' then
  if s.status<>'submitted' or s.retention_until<=now() or not s.review_consent or s.consultant_id is null
  then raise exception 'PETA_NOT_FOUND';end if;
  select result into strict r from public.peta_results where session_id=s.id;
  insert into public.peta_access_audit(workspace_id,session_id,actor_id,event) values(s.workspace_id,s.id,p_actor,'consultant_result_opened');
  return jsonb_build_object('result',r,'participantCode',s.participant_code,'submittedAt',s.submitted_at,'retentionUntil',s.retention_until);
 elsif p_action='recover' then
  if s.program_id is not null or not coalesce(p_verified,false) or s.status='revoked' or s.retention_until<=now() or p_hash is null
  then raise exception 'PETA_INVALID_REQUEST';end if;
  update public.peta_invitations set revoked_at=now() where session_id=s.id and redeemed_at is null and revoked_at is null;
  expiry:=least(now()+interval '30 minutes',s.retention_until);
  insert into public.peta_invitations(workspace_id,token_hash,participant_code,purpose,session_id,expires_at)
   values(s.workspace_id,p_hash,s.participant_code,'resume',s.id,expiry);
  insert into public.peta_access_audit(workspace_id,session_id,actor_id,event) values(s.workspace_id,s.id,p_actor,'recovery_issued_after_verification');
  return jsonb_build_object('expiresAt',expiry);
 elsif p_action='revoke' then
  update public.peta_sessions set status='revoked',updated_at=now() where id=s.id;
  delete from public.peta_credentials where session_id=s.id;
  update public.peta_invitations set revoked_at=now() where session_id=s.id and revoked_at is null;
 elsif p_action='erase' then
  if not coalesce(p_verified,false) then raise exception 'PETA_INVALID_REQUEST';end if;
  delete from public.peta_sessions where id=s.id;
 else raise exception 'PETA_INVALID_REQUEST';end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(s.workspace_id,p_actor,p_action);
 return jsonb_build_object('done',true);
end $$;

create or replace function public.peta_team_invitation_create(p_actor uuid,p_workspace uuid,p_hash text,p_code text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare i public.peta_invitations;
begin
 if p_actor is null then raise exception 'PETA_NOT_FOUND';end if;
 if not exists(select 1 from public.peta_workspaces where id=p_workspace and program_id is null and enabled)
 then raise exception 'PETA_NOT_FOUND';end if;
 if not exists(select 1 from public.peta_instruments where instrument_id='PETA-DISC-FC24' and version='1.0.0-pilot')
 then raise exception 'PETA_SETUP_REQUIRED';end if;
 insert into public.peta_invitations(workspace_id,token_hash,participant_code,expires_at)
  values(p_workspace,p_hash,p_code,now()+interval '7 days') returning * into i;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(p_workspace,p_actor,'invitation_created');
 return jsonb_build_object('id',i.id,'expiresAt',i.expires_at);
end $$;

create or replace function public.peta_team_invitation_revoke(p_actor uuid,p_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare w_id uuid;
begin
 if p_actor is null then raise exception 'PETA_NOT_FOUND';end if;
 update public.peta_invitations set revoked_at=now() where id=p_id and redeemed_at is null and revoked_at is null returning workspace_id into w_id;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event) values(w_id,p_actor,'invitation_revoked');return true;
end $$;

-- No table grants or participant-facing RPC permissions are widened.
revoke all on function public.peta_team_dashboard(uuid,uuid,text,integer,text,text),
 public.peta_team_program_setup(uuid,uuid,text,boolean),public.peta_team_session_action(uuid,uuid,text,text,boolean),
 public.peta_team_invitation_create(uuid,uuid,text,text),public.peta_team_invitation_revoke(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.peta_team_dashboard(uuid,uuid,text,integer,text,text),
 public.peta_team_program_setup(uuid,uuid,text,boolean),public.peta_team_session_action(uuid,uuid,text,text,boolean),
 public.peta_team_invitation_create(uuid,uuid,text,text),public.peta_team_invitation_revoke(uuid,uuid) to service_role;
commit;
