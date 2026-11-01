-- SQL80: private PETA individual PDFs and INTERNAL admin group reporting.
-- Requires SQL76-79. No consent, answers, results, retention or grants are changed.
-- These functions trust only the API's verified admin actor / scoped credential.
begin;

create or replace function public.peta_participant_pdf_data(p_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;s public.peta_sessions;person text;program text;
begin
 r:=public.peta_read_result(p_hash);
 select s0.* into strict s from public.peta_sessions s0 join public.peta_credentials c on c.session_id=s0.id where c.token_hash=p_hash;
 select p.name into person from public.participants p where p.id=s.participant_id;
 select coalesce(e.title,w.name) into program from public.peta_workspaces w left join public.engagements e on e.id=w.program_id where w.id=s.workspace_id;
 insert into public.peta_access_audit(workspace_id,session_id,event) values(s.workspace_id,s.id,'participant_pdf_requested');
 return jsonb_build_object('report',r,'participantName',person,'programName',program,'issuedAt',now());
end $$;

create or replace function public.peta_team_individual_pdf_data(p_actor uuid,p_session uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;s public.peta_sessions;person text;program text;
begin
 -- Reuse the exact submitted / review-consent / retention check and row lock.
 r:=public.peta_team_session_action(p_actor,p_session,'result',null,false);
 select * into strict s from public.peta_sessions where id=p_session;
 select p.name into person from public.participants p where p.id=s.participant_id;
 select coalesce(e.title,w.name) into program from public.peta_workspaces w left join public.engagements e on e.id=w.program_id where w.id=s.workspace_id;
 insert into public.peta_access_audit(workspace_id,session_id,actor_id,event) values(s.workspace_id,s.id,p_actor,'admin_individual_pdf_requested');
 return jsonb_build_object('report',r,'participantName',person,'programName',program,'issuedAt',now());
end $$;

create or replace function public.peta_team_group_report(p_actor uuid,p_workspace uuid,p_export boolean default false)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.peta_workspaces;title text;members jsonb;counts jsonb;n bigint;
begin
 if p_actor is null or p_workspace is null or p_export is null then raise exception 'PETA_INVALID_REQUEST';end if;
 select * into w from public.peta_workspaces where id=p_workspace;
 if not found then raise exception 'PETA_NOT_FOUND';end if;
 select coalesce(e.title,ws.name) into title from public.peta_workspaces ws left join public.engagements e on e.id=ws.program_id where ws.id=p_workspace;
 -- One program/workspace, all records, independent of dashboard pagination or filters.
 -- Lock the snapshot against concurrent revoke/erase/retention until the RPC finishes.
 perform id from public.peta_sessions where workspace_id=p_workspace order by id for share;
 with classified as (
  select s.*,r.result,p.name,
   case when s.retention_until<=now() or s.status='revoked' then 'unavailable'
    when s.status<>'submitted' then 'unfinished'
    when not s.review_consent or s.consultant_id is null then 'restricted'
    when r.result is null then 'unavailable' else 'included' end as eligibility
  from public.peta_sessions s left join public.peta_results r on r.session_id=s.id
   left join public.participants p on p.id=s.participant_id where s.workspace_id=p_workspace
 ) select jsonb_build_object('total',count(*),'included',count(*) filter(where eligibility='included'),
   'unfinished',count(*) filter(where eligibility='unfinished'),'restricted',count(*) filter(where eligibility='restricted'),
   'unavailable',count(*) filter(where eligibility='unavailable')),
   coalesce(jsonb_agg(jsonb_build_object('participantName',name,'report',jsonb_build_object('result',result,
    'participantCode',participant_code,'submittedAt',submitted_at,'retentionUntil',retention_until))
    order by lower(coalesce(name,participant_code)),id) filter(where eligibility='included'),'[]'::jsonb),
   count(*) filter(where eligibility='included') into counts,members,n from classified;
 if n>500 then raise exception 'PETA_REPORT_TOO_LARGE';end if;
 if p_export and n=0 then raise exception 'PETA_NO_REVIEWABLE_RESULTS';end if;
 insert into public.peta_access_audit(workspace_id,actor_id,event)
  values(p_workspace,p_actor,case when p_export then 'admin_group_pdf_requested' else 'admin_group_report_opened' end);
 return jsonb_build_object('workspaceId',w.id,'programName',title,'audience','internal_admin','issuedAt',now(),'counts',counts,'members',members);
end $$;

revoke all on function public.peta_participant_pdf_data(text),public.peta_team_individual_pdf_data(uuid,uuid),
 public.peta_team_group_report(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.peta_participant_pdf_data(text),public.peta_team_individual_pdf_data(uuid,uuid),
 public.peta_team_group_report(uuid,uuid,boolean) to service_role;
commit;
