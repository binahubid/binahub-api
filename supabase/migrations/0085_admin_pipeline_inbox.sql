-- SQL85: read-only pipeline archive. Does not send, re-score, or update opportunities.
begin;
create or replace function public.admin_pipeline_record(l public.leads, p_detail boolean default false)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
  'id',l.id,'name',coalesce(l.name,'-'),'email',coalesce(l.email,'-'),'company',coalesce(l.company,'-'),
  'industry',l.industry,'location',l.location,'qualificationProfile',case when p_detail then coalesce(l.qualification_profile,'{}'::jsonb) else '{}'::jsonb end,
  'phone',coalesce(l.phone,''),'source',coalesce(nullif(l.source,''),'lead'),'leadScore',l.lead_score,
  'leadTemperature',coalesce(nullif(l.lead_temperature,''),nullif(l.lead_status,''),'unclassified'),'leadScoreConfidence',l.lead_score_confidence,
  'lifecycleStage',coalesce(nullif(l.lifecycle_stage,''),'prospect'),'opportunityStage',coalesce(nullif(l.opportunity_stage,''),'identified'),
  'opportunityOwner',nullif(l.opportunity_owner,''),'nextAction',nullif(l.next_action,''),'nextActionDueAt',l.next_action_due_at,
  'leadTimeZone',coalesce(nullif(l.lead_time_zone,''),'Asia/Jakarta'),'opportunityValue',l.opportunity_value,'lostReason',nullif(l.lost_reason,''),
  'wonAt',l.won_at,'lostAt',l.lost_at,'outreachPaused',coalesce(l.outreach_paused,false),'outreachPauseReason',nullif(l.outreach_pause_reason,''),
  'outreachPausedAt',l.outreach_paused_at,'outreachPausedBy',l.outreach_paused_by,'pipelineUpdatedAt',coalesce(l.pipeline_updated_at,l.created_at),'createdAt',l.created_at);
$$;

create or replace function public.admin_pipeline_inbox(
 p_page integer default 0,p_search text default '',p_view text default 'active',p_priority text default 'all',
 p_owner text default '',p_source text default '',p_stage text default '',p_sort text default 'priority',p_tests boolean default false)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_view is null or p_view not in ('active','won','lost','review') or p_priority is null or p_priority not in ('all','attention','overdue','unassigned','paused')
  or p_owner is null or length(p_owner)>320 or p_source is null or length(p_source)>150
  or p_stage is null or p_stage not in ('','identified','qualified','consultation','proposal','negotiation')
  or p_sort is null or p_sort not in ('priority','value','newest') or p_tests is null then raise exception 'PIPELINE_INBOX_INVALID'; end if;
 with base as materialized (
  select l.*,coalesce(nullif(opportunity_stage,''),'identified') as stage,coalesce(nullif(source,''),'lead') as source_key,
   coalesce(nullif(opportunity_stage,''),'identified') in ('identified','qualified','consultation','proposal','negotiation') as active
  from public.leads l where p_tests or not (
   coalesce(email,'') ~* '@example\.invalid$' or concat_ws(' ',name,email,company,source) ~* '\mphase\s*1[0-9]\M|\mphase1[0-9][-_]')
 ), flagged as materialized (
  select *,active and next_action_due_at<now() as overdue,
   active and (btrim(coalesce(opportunity_owner,''))='' or next_action_due_at<now()
    or (stage<>'identified' and (btrim(coalesce(next_action,''))='' or next_action_due_at is null))) as attention,
   case when active then (case when next_action_due_at<now() then 100 else 0 end)
    +(case when btrim(coalesce(opportunity_owner,''))='' then 60 else 0 end)
    +(case when stage<>'identified' and (btrim(coalesce(next_action,''))='' or next_action_due_at is null) then 45 else 0 end)
    +(case when next_action_due_at between now() and now()+interval '1 day' then 25 else 0 end)
    +(case when coalesce(nullif(lead_temperature,''),lead_status)='hot' then 15 else 0 end) else 0 end as priority_score
  from base
 ), filtered as materialized (
  select * from flagged where (case p_view when 'active' then active when 'review' then stage not in ('identified','qualified','consultation','proposal','negotiation','won','lost') else stage=p_view end)
   and (p_search='' or strpos(lower(concat_ws(' ',name,email,company,opportunity_owner,next_action,
    case source_key when 'assessment' then 'Self Diagnostic' when 'outbound' then 'Outbound' when 'inquiry' then 'Pertanyaan masuk'
     when 'contact' then 'Form kontak' when 'website' then 'Website' when 'calcom' then 'Konsultasi' when 'manual_upload' then 'Impor manual' else replace(source_key,'_',' ') end,
    industry,location)),lower(p_search))>0)
   and (p_owner='' or case when p_owner='unassigned' then btrim(coalesce(opportunity_owner,''))='' else opportunity_owner=p_owner end)
   and (p_source='' or source_key=p_source) and (p_stage='' or p_view<>'active' or stage=p_stage)
   and (p_priority='all' or active and case p_priority when 'attention' then attention when 'overdue' then overdue
    when 'unassigned' then btrim(coalesce(opportunity_owner,''))='' else coalesce(outreach_paused,false) end)
 ), ordered as (
  select *,row_number() over(order by
   case when p_sort='value' then coalesce(opportunity_value,0) end desc,
   case when p_sort='newest' then created_at end desc nulls last,
   case when p_sort='priority' then priority_score end desc,
   case when p_sort='priority' and active then next_action_due_at end asc nulls last,
   case when p_sort='priority' then coalesce(opportunity_value,0) end desc,id) as pos from filtered
 ), page_rows as (select * from ordered order by pos limit 20 offset p_page*20)
 select jsonb_build_object('version',1,'page',p_page,'pageSize',20,'snapshotAt',now(),
  'total',(select count(*) from filtered),'totalValue',(select coalesce(sum(opportunity_value),0) from filtered),
  'records',coalesce((select jsonb_agg(public.admin_pipeline_record(l) order by p.pos) from page_rows p join public.leads l on l.id=p.id),'[]'::jsonb),
  'counts',(select jsonb_build_object('all',count(*) filter(where active),'attention',count(*) filter(where attention),
   'overdue',count(*) filter(where overdue),'unassigned',count(*) filter(where active and btrim(coalesce(opportunity_owner,''))=''),
   'paused',count(*) filter(where active and outreach_paused),'value',coalesce(sum(opportunity_value) filter(where active),0),
   'valued',count(*) filter(where active and opportunity_value is not null)) from flagged),
  'views',(select jsonb_build_object('active',count(*) filter(where active),'won',count(*) filter(where stage='won'),
   'lost',count(*) filter(where stage='lost'),'review',count(*) filter(where stage not in ('identified','qualified','consultation','proposal','negotiation','won','lost'))) from flagged),
  'stages',coalesce((select jsonb_object_agg(stage,jsonb_build_object('total',total,'value',value,'valued',valued)) from
   (select stage,count(*) as total,coalesce(sum(opportunity_value),0) as value,count(opportunity_value) as valued from filtered group by stage) s),'{}'::jsonb),
  'facets',jsonb_build_object('owners',coalesce((select jsonb_agg(opportunity_owner order by opportunity_owner) from (select distinct opportunity_owner from base where btrim(coalesce(opportunity_owner,''))<>'') s),'[]'::jsonb),
   'sources',coalesce((select jsonb_agg(source_key order by source_key) from (select distinct source_key from base) s),'[]'::jsonb))) into result;
 return result;
end; $$;

create or replace function public.admin_pipeline_detail(p_id uuid,p_history_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_id is null or p_history_page is null or p_history_page not between 0 and 10000 then raise exception 'PIPELINE_DETAIL_INVALID'; end if;
 select jsonb_build_object('record',public.admin_pipeline_record(l,true),'context',jsonb_build_object(
  'historyPage',p_history_page,'activityTotal',(select count(*) from public.opportunity_activities a where a.lead_id=l.id),
  'activities',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'leadId',a.lead_id,'assessmentId',a.assessment_id,'inquiryId',a.inquiry_id,
   'eventType',a.event_type,'fromStage',a.from_stage,'toStage',a.to_stage,'actor',a.actor,'note',a.note,'metadata','{}'::jsonb,'createdAt',a.created_at)
   order by a.created_at desc,a.id) from (select * from public.opportunity_activities where lead_id=l.id order by created_at desc,id limit 20 offset p_history_page*20) a),'[]'::jsonb),
  'assessments',(select count(*) from public.assessments a where a.lead_id=l.id),
  'meetings',(select count(*) from public.calendar_bookings b where b.lead_id=l.id or exists(select 1 from public.assessments a where a.id=b.assessment_id and a.lead_id=l.id)),
  'accountId',(select c.id from public.client_accounts c where c.source_lead_id=l.id order by c.created_at desc,c.id limit 1))) into result
 from public.leads l where l.id=p_id;
 return result;
end; $$;
revoke all on function public.admin_pipeline_record(public.leads,boolean),public.admin_pipeline_inbox(integer,text,text,text,text,text,text,text,boolean),public.admin_pipeline_detail(uuid,integer) from public,anon,authenticated;
grant execute on function public.admin_pipeline_record(public.leads,boolean),public.admin_pipeline_inbox(integer,text,text,text,text,text,text,text,boolean),public.admin_pipeline_detail(uuid,integer) to service_role;
commit;
