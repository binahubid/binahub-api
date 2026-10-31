-- SQL78: preserve manual status and paginate PETA history independently of program access.
-- Requires SQL76 + SQL77. No participant data, permissions or retention dates are changed.
begin;
alter table public.engagements add column if not exists status_mode text not null default 'automatic'
 check (status_mode in ('automatic','manual'));

create or replace function public.peta_management_dashboard(p_actor uuid,p_workspace uuid default null,
 p_scope text default 'active',p_page integer default 0,p_search text default '',p_status text default 'all')
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; programs jsonb; workspaces jsonb; sessions jsonb; scope_ids uuid[];
 total bigint; counts jsonb; needle text;
begin
 if p_actor is null or p_scope is null or p_scope not in ('active','history','all') or p_page is null or p_page<0 or p_page>100000
  or p_search is null or length(p_search)>150 or p_status is null or p_status not in ('all','in_progress','submitted','revoked','expired')
 then raise exception 'PETA_INVALID_REQUEST';end if;
 if p_workspace is not null and not exists(select 1 from public.peta_workspaces where id=p_workspace and owner_id=p_actor)
 then raise exception 'PETA_NOT_FOUND';end if;
 -- The active picker is for new participation only. History never depends on this list.
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'code',e.code,'status',e.status,'petaEnabled',true)
  order by e.title,e.id),'[]'::jsonb) into programs from public.engagements e
 where e.status in ('active','in_progress') and (e.end_date is null or e.end_date>=(now() at time zone 'Asia/Jakarta')::date)
 and exists(select 1 from public.program_modules m where m.program_id=e.id and m.module_key='peta' and m.enabled);
 result:=public.peta_program_dashboard(p_actor);
 select coalesce(jsonb_agg(value||jsonb_build_object('name',coalesce(e.title,value->>'name'))),'[]'::jsonb)
 into workspaces from jsonb_array_elements(result->'workspaces') value
 left join public.engagements e on e.id=(value->>'programId')::uuid;
 select coalesce(array_agg(w.id),'{}'::uuid[]) into scope_ids from public.peta_workspaces w
 where w.owner_id=p_actor and (p_workspace is null or w.id=p_workspace)
 and (p_scope='all' or (p_scope='active')=exists(select 1 from jsonb_array_elements(programs) p where (p->>'id')::uuid=w.program_id));
 select jsonb_build_object('total',count(*),'inProgress',count(*) filter(where status='in_progress' and retention_until>now()),
  'submitted',count(*) filter(where status='submitted' and retention_until>now())) into counts
 from public.peta_sessions where workspace_id=any(scope_ids);
 -- Literal substring search: user '%'/'_' never turn into wildcard match-all.
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
  'canReadResult',coalesce(s.review_consent and s.consultant_id=p_actor and s.status='submitted' and s.retention_until>now(),false))
  order by s.created_at desc,s.id desc),'[]'::jsonb) into sessions from (
   select s.* from public.peta_sessions s left join public.participants p on p.id=s.participant_id
   where s.workspace_id=any(scope_ids)
   and (p_status='all' or p_status=case when s.retention_until<=now() then 'expired' else s.status end)
   and (needle='' or strpos(lower(coalesce(p.name,'')||' '||s.participant_code),needle)>0)
   order by s.created_at desc,s.id desc limit 20 offset p_page*20
  ) s left join public.participants p on p.id=s.participant_id;
 return result||jsonb_build_object('programs',programs,'workspaces',workspaces,'sessions',sessions,
  'counts',counts,'total',total,'page',p_page,'pageSize',20);
end $$;
revoke all on function public.peta_management_dashboard(uuid,uuid,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.peta_management_dashboard(uuid,uuid,text,integer,text,text) to service_role;
commit;
