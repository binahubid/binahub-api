-- SQL86: read-only CRM priorities. No claims, sends, scores, statuses, or records are changed.
begin;
create or replace function public.admin_sales_tasks()
returns table(id text,record_id uuid,kind text,name text,company text,email text,source text,note text,action text,view text,detail text,priority integer,at timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $$
 with blocked_leads as materialized (
  select id,lower(btrim(email)) as email from public.leads where outreach_paused or lower(opportunity_stage) in ('consultation','negotiation','won','lost')
 ), blocked_bookings as materialized (
  select lead_id,assessment_id,lower(btrim(attendee_email)) as email from public.calendar_bookings
  where lower(status) in ('requested','confirmed','rescheduled','completed')
 ), event_totals as materialized (
  select coalesce(lead_id::text,target_type||':'||target_id::text) as scope,count(*) as total from public.follow_up_events group by 1
 ), claim_totals as materialized (
  select coalesce(lead_id::text,target_type||':'||target_id::text) as scope,count(*) as total from public.follow_up_claims
  where status in ('processing','sent','delivery_unconfirmed') group by 1
 ), inquiry_source as (
  select i.id,i.lead_id,coalesce(nullif(i.name,''),'-') as name,'Inquiry masuk'::text as company,coalesce(nullif(i.email,''),'-') as email,
   coalesce(nullif(i.source,''),'Belum tercatat') as source,i.created_at,i.reply_sent_at,coalesce(i.reply_status,'none') as reply_status,
   coalesce(i.follow_up_level,0) as level,coalesce(i.follow_up_paused,false) as paused
  from public.inquiries i where lower(btrim(coalesce(i.status,''))) not in ('closed','deal','lost','client','selesai','diarsipkan','won','lanjut diskusi','qualified','unsubscribed','follow up 3 terkirim')
 ), assessment_source as (
  select a.*,public.admin_assessment_object(a.form_data) as form,
   coalesce(nullif(a.assessment_status,''),case when a.result_email_sent_at is not null then 'Result Email Terkirim' else 'Result Otomatis Terkirim' end) as result_status,
   coalesce(nullif(a.proposal_status,''),'Belum Diminta') as proposal_state,
   (a.proposal_sent_at is not null or a.proposal_status='Terkirim') is true as sent,
   (jsonb_typeof(a.proposal_draft_data->'proposal')='object' and coalesce(a.proposal_draft_data->>'automatic','false')<>'true') is true as manual,
   l.name as lead_name,l.email as lead_email,l.company as lead_company
  from public.assessments a left join public.leads l on l.id=a.lead_id
  where lower(btrim(coalesce(a.assessment_status,''))) not in ('closed','deal','lost','client','selesai','diarsipkan','won','unsubscribed')
   and lower(btrim(coalesce(a.proposal_status,''))) not in ('closed','deal','lost','client','selesai','diarsipkan','won','unsubscribed')
 ), assessment_flags as (
  select *,coalesce(nullif(form->>'name',''),nullif(lead_name,''),'-') as name,
   coalesce(nullif(form->>'email',''),nullif(lead_email,''),'-') as email,
   coalesce(nullif(form->>'company',''),nullif(lead_company,''),'-') as company,
   coalesce(nullif(public.admin_assessment_object(form->'attribution')->>'utmSource',''),nullif(public.admin_assessment_object(form->'attribution')->>'utm_source',''),'Self Diagnostic website') as source,
   not sent and not manual and proposal_state='Sedang Disusun' as processing,
   not sent and proposal_state='Perlu Rekonsiliasi' as reconcile,not sent and proposal_state='Gagal Otomatis' as failed
  from assessment_source
 ), assessment_states as (
  select *,not sent and (proposal_state='Diminta' or reconcile or failed or
   ((proposal_state='Menunggu Approval' or proposal_gate_status in ('pending_approval','revision_required','rejected')) and not processing)) as needs_proposal,
   case when reconcile then 'Periksa pengiriman' when failed then 'Perlu dicoba ulang' when proposal_state='Diminta' then 'Proposal diminta' else 'Proposal perlu ditinjau' end as proposal_label
  from assessment_flags
 ), followup_candidates as (
  select 'inquiry'::text as target_type,i.id,i.lead_id,i.name,i.company,i.email,i.source,i.created_at as at,'inquiry'::text as channel,i.level+1 as level
  from inquiry_source i where i.reply_sent_at is not null and i.reply_status<>'sending' and not i.paused and i.level between 0 and 2
   and statement_timestamp()-i.reply_sent_at>=make_interval(days=>case i.level when 0 then 2 when 1 then 7 else 14 end)
  union all
  select 'assessment',a.id,a.lead_id,a.name,a.company,a.email,a.source,coalesce(a.proposal_requested_at,a.created_at),c.channel,c.level
  from assessment_states a cross join lateral (
   select 'result'::text as channel,coalesce(a.result_follow_up_level,0)+1 as level
   where coalesce(a.result_follow_up_level,0) between 0 and 2
    and a.result_status not in ('Minta Proposal','Proposal Terkirim','Lanjut Diskusi','Closed')
    and a.proposal_state not in ('Diminta','Sedang Disusun','Gagal Otomatis','Perlu Rekonsiliasi','Menunggu Approval','Terkirim','Revisi','Lanjut Diskusi','Deal','Lost','Closed')
    and statement_timestamp()-a.result_email_sent_at >= make_interval(days=>case coalesce(a.result_follow_up_level,0) when 0 then 2 when 1 then 7 else 14 end)
   union all
   select 'proposal',1 where coalesce(a.proposal_follow_up_level,0)=0
    and a.proposal_state not in ('Revisi','Lanjut Diskusi','Deal','Lost','Closed') and statement_timestamp()-a.proposal_sent_at>=interval '2 days'
  ) c where not coalesce(a.needs_proposal,false) and a.result_email_sent_at is not null and not coalesce(a.follow_up_paused,false)
 ), allowed_followups as (
  select c.*,row_number() over(partition by c.target_type,c.id order by case c.channel when 'result' then 0 else 1 end) as choice
  from followup_candidates c
  left join event_totals e on e.scope=coalesce(c.lead_id::text,c.target_type||':'||c.id::text)
  left join claim_totals t on t.scope=coalesce(c.lead_id::text,c.target_type||':'||c.id::text)
  where coalesce(e.total,0)<3 and coalesce(t.total,0)<3
   and not exists(select 1 from public.follow_up_claims f where f.target_type=c.target_type and f.target_id=c.id and f.channel=c.channel and f.level=c.level)
   and not exists(select 1 from blocked_leads l where l.id=c.lead_id or (btrim(c.email) not in ('','-') and l.email=lower(btrim(c.email))))
   and not exists(select 1 from blocked_bookings b where b.lead_id=c.lead_id or (c.target_type='assessment' and b.assessment_id=c.id)
    or (btrim(c.email) not in ('','-') and b.email=lower(btrim(c.email))))
   and not exists(select 1 from public.email_suppressions s where s.email=lower(btrim(c.email)))
 ), tasks as (
  select 'inquiry:'||i.id as id,i.id as record_id,'inquiry'::text as kind,i.name,i.company,i.email,i.source,
   case when i.reply_status='sent' then 'Status balasan terkirim perlu diperiksa' else 'Pertanyaan klien belum dibalas' end as note,
   case when i.reply_status='sent' then 'Periksa balasan' else 'Tulis balasan' end as action,'clients'::text as view,null::text as detail,1 as priority,i.created_at as at
  from inquiry_source i where i.reply_sent_at is null and i.reply_status<>'sending'
  union all
  select 'proposal:'||a.id,a.id,'proposal',a.name,a.company,a.email,a.source,a.proposal_label,
   case when a.reconcile then 'Periksa pengiriman' else 'Buka proposal' end,'clients','proposal',0,coalesce(a.proposal_requested_at,a.created_at)
  from assessment_states a where a.needs_proposal
  union all
  select 'assessment:'||a.id,a.id,'assessment',a.name,a.company,a.email,a.source,'Pengiriman hasil belum tercatat','Periksa hasil','clients','summary',2,coalesce(a.proposal_requested_at,a.created_at)
  from assessment_states a where not coalesce(a.needs_proposal,false) and a.result_email_sent_at is null
  union all
  select 'followup:'||f.target_type||':'||f.id,f.id,'followup',f.name,f.company,f.email,f.source,
   case f.channel when 'inquiry' then 'Pengingat percakapan ' when 'result' then 'Pengingat hasil ' else 'Pengingat proposal ' end||f.level||' siap ditinjau',
   'Tinjau tindak lanjut','clients',case when f.target_type='assessment' then 'followup' else null end,3,f.at from allowed_followups f where f.choice=1
  union all
  select 'pipeline:'||l.id,l.id,'pipeline',coalesce(l.name,'-'),coalesce(l.company,'-'),coalesce(l.email,'-'),coalesce(nullif(l.source,''),'Peluang penjualan'),
   coalesce(nullif(l.next_action,''),'Tentukan langkah berikutnya'),'Buka peluang','pipeline',null,2,l.next_action_due_at
  from public.leads l where coalesce(nullif(l.opportunity_stage,''),'identified') not in ('won','lost') and l.next_action_due_at<=statement_timestamp()
 ) select * from tasks;
$$;

create or replace function public.admin_sales_priorities(p_page integer default 0,p_search text default '',p_view text default 'all',p_kind text default 'all')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_view is null or p_view not in ('all','followup') or p_kind is null or p_kind not in ('all','inquiry','assessment','proposal','followup','pipeline') then raise exception 'SALES_PRIORITIES_INVALID'; end if;
 with all_tasks as materialized(select * from public.admin_sales_tasks()), filtered as (
  select * from all_tasks where (p_view='all' or kind='followup') and (p_kind='all' or kind=p_kind)
   and (p_search='' or strpos(lower(name||' '||company||' '||email||' '||source),lower(p_search))>0)
 ), page_rows as (select * from filtered order by priority,at asc nulls first,id limit 20 offset p_page*20)
 select jsonb_build_object('version',1,'page',p_page,'pageSize',20,'snapshotAt',statement_timestamp(),'total',(select count(*) from filtered),
  'counts',jsonb_build_object('all',(select count(*) from all_tasks),'proposal',(select count(*) from all_tasks where kind='proposal'),
   'followup',(select count(*) from all_tasks where kind='followup'),'won',(select count(*) from public.leads where opportunity_stage='won')),
  'records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'recordId',record_id,'kind',kind,'name',name,'company',company,'email',email,
   'source',source,'note',left(note,500),'action',action,'view',view,'detail',detail,'priority',priority,'at',at) order by priority,at asc nulls first,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.admin_sales_tasks(),public.admin_sales_priorities(integer,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_sales_tasks(),public.admin_sales_priorities(integer,text,text,text) to service_role;
commit;
