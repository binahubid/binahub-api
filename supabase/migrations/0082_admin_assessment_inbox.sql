-- SQL82: read-only organization diagnosis inbox; no data or delivery changes.
begin;

create or replace function public.admin_assessment_object(p_value jsonb) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare v jsonb := p_value;
begin
 if jsonb_typeof(v)='string' then
  begin v := (v #>> '{}')::jsonb; exception when invalid_text_representation then return '{}'::jsonb; end;
 end if;
 return case when jsonb_typeof(v)='object' then v else '{}'::jsonb end;
end; $$;

create or replace function public.admin_assessment_number(p_value jsonb) returns integer
language plpgsql immutable set search_path=pg_catalog as $$
declare v numeric;
begin
 if p_value is null or p_value='null'::jsonb then return 0; end if;
 if p_value='true'::jsonb then return 1; end if;
 if p_value='false'::jsonb then return 0; end if;
 v := nullif(btrim(p_value #>> '{}'),'')::numeric;
 if v is null or v::text in ('NaN','Infinity','-Infinity') then return 0; end if;
 return floor(v+0.5)::integer;
exception when invalid_text_representation or numeric_value_out_of_range then return 0;
end; $$;

create or replace function public.admin_assessment_inbox(
 p_page integer default 0, p_search text default '', p_category text default '',
 p_employees text default '', p_min_score integer default 0,
 p_queue text default 'all', p_sort text default 'latest'
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_category is null or length(p_category)>150 or p_employees is null or length(p_employees)>150
  or p_min_score is null or p_min_score not between 0 and 100
  or p_queue is null or p_queue not in ('all','attention','processing','sent')
  or p_sort is null or p_sort not in ('latest','attention') then raise exception 'ASSESSMENT_INBOX_INVALID'; end if;

 with source as (
  select a.id,a.created_at,jsonb_build_object(
   'category',a.category,'overall_score',a.overall_score,'assessment_status',a.assessment_status,
   'result_email_sent_at',a.result_email_sent_at,'proposal_status',a.proposal_status,
   'proposal_gate_status',a.proposal_gate_status,'proposal_sent_at',a.proposal_sent_at,
   'proposal_draft_data',case when jsonb_typeof(a.proposal_draft_data->'proposal')='object'
    then jsonb_build_object('proposal','{}'::jsonb,'automatic',a.proposal_draft_data->'automatic') else null end,
   'follow_up_paused',a.follow_up_paused,'result_follow_up_level',a.result_follow_up_level,
   'proposal_follow_up_level',a.proposal_follow_up_level
  ) as row,
   public.admin_assessment_object(a.form_data) as form,
   public.admin_assessment_object(a.scores) as scores,
   jsonb_build_object('name',l.name,'email',l.email,'company',l.company) as lead
  from public.assessments a left join public.leads l on l.id=a.lead_id
 ), normalized as (
  select id,created_at,row,form,
   coalesce(nullif(form->>'name',''),nullif(lead->>'name',''),'-') as name,
   coalesce(nullif(form->>'email',''),nullif(lead->>'email',''),'-') as email,
   coalesce(nullif(form->>'company',''),nullif(lead->>'company',''),'-') as company,
   coalesce(nullif(form->>'role',''),'-') as role,
   coalesce(nullif(form->>'employees',''),'Tidak diketahui') as employees,
   coalesce(nullif(row->>'category',''),'Tidak diketahui') as category,
   public.admin_assessment_number(coalesce(nullif(scores->'overall','null'::jsonb),row->'overall_score')) as score,
   coalesce(nullif(row->>'assessment_status',''),case when row->>'result_email_sent_at' is not null then 'Result Email Terkirim' else 'Result Otomatis Terkirim' end) as assessment_status,
   coalesce(nullif(row->>'proposal_status',''),'Belum Diminta') as proposal_status,
   coalesce(nullif(row->>'proposal_gate_status',''),'not_evaluated') as gate,
   (row->>'proposal_sent_at' is not null or row->>'proposal_status'='Terkirim') is true as sent,
   (jsonb_typeof(row->'proposal_draft_data'->'proposal')='object'
    and coalesce(row->'proposal_draft_data'->>'automatic','false') <> 'true') is true as manual,
   (row->>'follow_up_paused'='true') is true as paused,
   public.admin_assessment_number(row->'result_follow_up_level') as result_level,
   public.admin_assessment_number(row->'proposal_follow_up_level') as proposal_level
  from source
 ), states as (
  select *,not sent and not manual and proposal_status='Sedang Disusun' as processing,
   not sent and proposal_status='Perlu Rekonsiliasi' as reconcile,
   not sent and proposal_status='Gagal Otomatis' as failed
  from normalized
 ), flagged as (
  select *,
   coalesce((not sent and (failed or reconcile or proposal_status='Diminta'
    or ((proposal_status='Menunggu Approval' or gate in ('pending_approval','revision_required','rejected')) and not reconcile and not failed and not processing)))
   or (not paused and result_level<3
    and assessment_status not in ('Minta Proposal','Proposal Terkirim','Lanjut Diskusi','Closed')
    and proposal_status not in ('Diminta','Sedang Disusun','Gagal Otomatis','Perlu Rekonsiliasi','Menunggu Approval','Terkirim','Revisi','Lanjut Diskusi','Deal','Lost','Closed')
    and statement_timestamp()-coalesce((row->>'result_email_sent_at')::timestamptz,created_at)
     >= make_interval(days=>case greatest(0,result_level) when 0 then 2 when 1 then 7 else 14 end))
   or (not paused and proposal_level<1 and proposal_status not in ('Revisi','Lanjut Diskusi','Deal','Lost','Closed')
    and statement_timestamp()-(row->>'proposal_sent_at')::timestamptz >= interval '2 days'),false) as attention
  from states
 ), base_filtered as (
  select * from flagged where (p_search='' or strpos(lower(name||' '||email||' '||company||' '||role||' '||category||' '||assessment_status||' '||proposal_status),lower(p_search))>0)
   and (p_category='' or category=p_category) and (p_employees='' or employees=p_employees) and score>=p_min_score
 ), queue_filtered as (
  select * from base_filtered where p_queue='all' or (p_queue='attention' and attention) or (p_queue='processing' and processing) or (p_queue='sent' and sent)
 ), page_rows as (
  select * from queue_filtered order by case when p_sort='attention' then attention::int else 0 end desc,created_at desc,id
  limit 20 offset p_page*20
 ), dto as (
  select created_at,id,attention,jsonb_build_object(
   'id',id,'name',name,'email',email,'company',company,'role',role,'employees',employees,
   'category',category,'overallScore',score,'assessmentStatus',assessment_status,
   'proposalStatus',proposal_status,'proposalGateStatus',gate,
   'proposalDraft',case when manual then '{"proposal":{},"automatic":false}'::jsonb else null end,
   'proposalSentAt',row->'proposal_sent_at','resultEmailSentAt',row->'result_email_sent_at',
   'resultFollowUpLevel',result_level,'proposalFollowUpLevel',proposal_level,'followUpPaused',paused,
   'createdAt',created_at
  ) as value from page_rows
 ) select jsonb_build_object(
  'version',1,'page',p_page,'pageSize',20,'total',(select count(*) from queue_filtered),
  'records',coalesce((select jsonb_agg(value order by case when p_sort='attention' then attention::int else 0 end desc,created_at desc,id) from dto),'[]'::jsonb),
  'counts',jsonb_build_object('all',(select count(*) from base_filtered),'attention',(select count(*) from base_filtered where attention),
   'processing',(select count(*) from base_filtered where processing),'sent',(select count(*) from base_filtered where sent)),
  'facets',jsonb_build_object('categories',coalesce((select jsonb_agg(category order by category) from (select distinct category from flagged) c),'[]'::jsonb),
   'employees',coalesce((select jsonb_agg(employees order by employees) from (select distinct employees from flagged) e),'[]'::jsonb))
 ) into result;
 return result;
end; $$;

create index if not exists assessments_admin_inbox_created_idx on public.assessments(created_at desc,id);
-- Loaded only when the operator opens the existing answer-distribution section.
create or replace function public.admin_assessment_answer_distribution() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 with answers as (
  select public.admin_assessment_object(public.admin_assessment_object(form_data)->'answers') as value from public.assessments
 ), counts as (
  select q,jsonb_build_object('question','Q'||q,
   '1',count(*) filter(where value->>q::text='1'),'2',count(*) filter(where value->>q::text='2'),
   '3',count(*) filter(where value->>q::text='3'),'4',count(*) filter(where value->>q::text='4'),
   '5',count(*) filter(where value->>q::text='5')) as value
  from generate_series(1,49) q left join answers on true group by q
 ) select jsonb_agg(value order by q) from counts;
$$;
revoke all on function public.admin_assessment_object(jsonb),public.admin_assessment_number(jsonb),
 public.admin_assessment_inbox(integer,text,text,text,integer,text,text),public.admin_assessment_answer_distribution() from public,anon,authenticated;
grant execute on function public.admin_assessment_object(jsonb),public.admin_assessment_number(jsonb),
 public.admin_assessment_inbox(integer,text,text,text,integer,text,text),public.admin_assessment_answer_distribution() to service_role;
comment on function public.admin_assessment_inbox(integer,text,text,text,integer,text,text) is
 'Read-only admin diagnosis inbox. API authentication required; service_role only. Counts ignore queue but respect other filters. No raw answers or report narrative.';
commit;
