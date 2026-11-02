-- SQL83: read-only inquiry inbox. Does not send, generate, or change any record.
begin;

create or replace function public.admin_inquiry_inbox(
 p_page integer default 0, p_search text default '', p_source text default '', p_status text default ''
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_source is null or length(p_source)>150 or p_status is null or length(p_status)>150 then
  raise exception 'INQUIRY_INBOX_INVALID';
 end if;
 with normalized as (
  select id,created_at,coalesce(nullif(name,''),'-') as name,coalesce(nullif(email,''),'-') as email,
   coalesce(whatsapp,'') as whatsapp,coalesce(message,'') as message,
   coalesce(nullif(source,''),'contact_form') as source,coalesce(nullif(status,''),'Baru') as status,
   coalesce(nullif(reply_status,''),'none') as reply_status,reply_sent_at,
   coalesce(follow_up_level,0) as follow_up_level,coalesce(follow_up_paused,false) as follow_up_paused
  from public.inquiries
 ), flagged as (
  select *,coalesce(not follow_up_paused and follow_up_level between 0 and 2 and reply_sent_at is not null
   and status not in ('Lanjut Diskusi','Qualified','Client','Selesai','Diarsipkan','Closed','Follow Up 3 Terkirim')
   and statement_timestamp()-reply_sent_at >= make_interval(days=>case follow_up_level when 0 then 2 when 1 then 7 else 14 end),false) as due
  from normalized
 ), filtered as (
  select * from flagged where (p_search='' or strpos(lower(name||' '||email||' '||whatsapp||' '||message||' '||source||' '||status),lower(p_search))>0)
   and (p_source='' or source=p_source) and (p_status='' or status=p_status)
 ), page_rows as (
  select * from filtered order by created_at desc,id limit 20 offset p_page*20
 ), dto as (
  select created_at,id,jsonb_build_object('id',id,'name',name,'email',email,'messagePreview',left(message,500),
   'source',source,'status',status,'replyStatus',reply_status,'followUpDue',due,'createdAt',created_at) as value from page_rows
 ) select jsonb_build_object('version',1,'page',p_page,'pageSize',20,'total',(select count(*) from filtered),
  'records',coalesce((select jsonb_agg(value order by created_at desc,id) from dto),'[]'::jsonb),
  'counts',jsonb_build_object('fresh',(select count(*) from filtered where status ~* '^(baru|new)$'),
   'awaiting',(select count(*) from filtered where reply_status in ('none','draft')),
   'ready',(select count(*) from filtered where reply_status='reviewed'),'due',(select count(*) from filtered where due)),
  'facets',jsonb_build_object('sources',coalesce((select jsonb_agg(source order by source) from (select distinct source from flagged) s),'[]'::jsonb),
   'statuses',coalesce((select jsonb_agg(status order by status) from (select distinct status from flagged) s),'[]'::jsonb))
 ) into result;
 return result;
end; $$;
create index if not exists inquiries_admin_inbox_created_idx on public.inquiries(created_at desc,id);
revoke all on function public.admin_inquiry_inbox(integer,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_inquiry_inbox(integer,text,text,text) to service_role;
comment on function public.admin_inquiry_inbox(integer,text,text,text) is
 'Read-only admin inbox; API authentication required, service_role only. Counts respect search/source/status. No full messages, notes, reply bodies, or module data.';
commit;
