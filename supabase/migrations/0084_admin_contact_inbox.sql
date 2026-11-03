-- SQL84: read-only contact projection. No source records, statuses, or delivery are changed.
begin;
create or replace function public.admin_contact_records() returns table(
 id text,record_id uuid,name text,email text,whatsapp text,message text,source text,source_type text,
 category text,status text,notes text,created_at timestamptz,sources text[],search_text text
) language sql stable security definer set search_path=pg_catalog,public as $$
 with raw as (
  select l.id as record_id,coalesce(l.name,'-') as name,coalesce(l.email,'') as email,coalesce(l.phone,'') as whatsapp,
   coalesce(l.notes,'') as message,coalesce(nullif(l.source,''),'lead') as source,'lead'::text as source_type,
   case l.source when 'insight_assessment' then 'Klien Self Diagnostic' when 'contact_form' then 'Klien Inquiry' else 'Lead' end as category,
   coalesce(nullif(l.lead_status,''),'New Lead') as status,coalesce(l.notes,'') as notes,l.created_at
  from public.leads l
  union all select i.id,coalesce(i.name,'-'),coalesce(i.email,''),coalesce(i.whatsapp,''),coalesce(i.message,''),
   coalesce(nullif(i.source,''),'contact_form'),'inquiry','Inquiry',coalesce(nullif(i.status,''),'Baru'),coalesce(i.admin_notes,''),i.created_at from public.inquiries i
  union all select c.id,coalesce(nullif(c.name,''),'Coach BinaHub'),coalesce(c.email,''),coalesce(c.phone,''),
   coalesce(nullif(c.notes,''),nullif(c.bio,''),c.linkedin_summary,''),'coach','coach',coalesce(nullif(c.category,''),'Coach'),
   coalesce(nullif(c.status,''),'active'),coalesce(c.notes,''),c.created_at from public.coaches c
  union all select e.id,coalesce(nullif(e.name,''),'Karyawan BinaHub'),coalesce(e.email,''),coalesce(e.phone,''),coalesce(e.notes,''),'employee','employee',
   coalesce(nullif(e.department,''),nullif(e.role,''),'Karyawan'),coalesce(nullif(e.status,''),'active'),coalesce(e.notes,''),e.created_at from public.employees e
 ), keyed as (
  select *,case when btrim(email) not in ('','-') then 'email:'||lower(btrim(email))
   when regexp_replace(whatsapp,'[^0-9]','','g')<>'' then 'phone:'||regexp_replace(whatsapp,'[^0-9]','','g')
   else 'record:'||source_type||':'||record_id end as identity_key from raw
 ), ranked as (
  select *,row_number() over w as priority,first_value(notes) over w as primary_notes,first_value(source_type) over w as primary_type
  from keyed window w as (partition by identity_key order by (source_type='lead') desc,created_at desc nulls last,
   case source_type when 'lead' then 0 when 'inquiry' then 1 when 'coach' then 2 else 3 end,record_id)
 ) select (array_agg(source_type||':'||record_id order by priority))[1],(array_agg(record_id order by priority))[1],
  coalesce((array_agg(name order by priority) filter(where name not in ('','-')))[1],'-'),
  coalesce((array_agg(btrim(email) order by priority) filter(where btrim(email) not in ('','-')))[1],''),
  coalesce((array_agg(whatsapp order by priority) filter(where whatsapp<>''))[1],''),
  coalesce((array_agg(message order by case when primary_type='lead' and source_type='inquiry' then 0 else 1 end,priority) filter(where message<>'' and message<>primary_notes))[1],
   (array_agg(message order by priority) filter(where message<>''))[1],''),
  string_agg(distinct source,' + ' order by source),(array_agg(source_type order by priority))[1],
  string_agg(distinct category,' + ' order by category),(array_agg(status order by priority))[1],
  (array_agg(notes order by priority))[1],max(created_at),array_agg(distinct source order by source),
  lower(string_agg(name||' '||email||' '||whatsapp||' '||category||' '||status||' '||source,' '))
 from ranked group by identity_key;
$$;

create or replace function public.admin_contact_inbox(p_page integer default 0,p_search text default '',p_type text default '',p_category text default '',p_status text default '')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_type is null or p_type not in ('','lead','inquiry','coach','employee') or p_category is null or length(p_category)>150
  or p_status is null or length(p_status)>150 then raise exception 'CONTACT_INBOX_INVALID'; end if;
 with all_contacts as materialized (select * from public.admin_contact_records()), filtered as (
  select * from all_contacts where (p_search='' or strpos(search_text,lower(p_search))>0) and (p_type='' or source_type=p_type)
   and (p_category='' or category=p_category) and (p_status='' or status=p_status)
 ), page_rows as (select * from filtered order by created_at desc nulls last,id limit 20 offset p_page*20)
 select jsonb_build_object('version',1,'page',p_page,'pageSize',20,'total',(select count(*) from filtered),
  'records',coalesce((select jsonb_agg(jsonb_build_object('id',id,'recordId',record_id,'name',name,'email',email,'whatsapp',whatsapp,
   'source',source,'sourceType',source_type,'category',category,'status',status,'createdAt',created_at) order by created_at desc nulls last,id) from page_rows),'[]'::jsonb),
  'counts',jsonb_build_object('leads',(select count(*) from filtered where source_type='lead'),
   'reachable',(select count(*) from filtered where email<>'' or whatsapp<>''),
   'sources',(select count(distinct s) from filtered cross join lateral unnest(sources) s)),
  'facets',jsonb_build_object('types',coalesce((select jsonb_agg(source_type order by source_type) from (select distinct source_type from all_contacts) s),'[]'::jsonb),
   'categories',coalesce((select jsonb_agg(category order by category) from (select distinct category from all_contacts) s),'[]'::jsonb),
   'statuses',coalesce((select jsonb_agg(status order by status) from (select distinct status from all_contacts) s),'[]'::jsonb))) into result;
 return result;
end; $$;
create or replace function public.admin_contact_detail(p_type text,p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_type is null or p_type not in ('lead','inquiry','coach','employee') or p_id is null then raise exception 'CONTACT_DETAIL_INVALID'; end if;
 select jsonb_build_object('id',id,'recordId',record_id,'name',name,'email',email,'whatsapp',whatsapp,'message',message,
  'source',source,'sourceType',source_type,'category',category,'status',status,'notes',notes,'createdAt',created_at)
 into result from public.admin_contact_records() where source_type=p_type and record_id=p_id;
 return result;
end; $$;
revoke all on function public.admin_contact_records(),public.admin_contact_inbox(integer,text,text,text,text),public.admin_contact_detail(text,uuid) from public,anon,authenticated;
grant execute on function public.admin_contact_records(),public.admin_contact_inbox(integer,text,text,text,text),public.admin_contact_detail(text,uuid) to service_role;
comment on function public.admin_contact_inbox(integer,text,text,text,text) is
 'Read-only merged contact inbox, service_role only. Merge precedes filters and pagination; lead remains primary. No notes or message in list DTO.';
commit;
