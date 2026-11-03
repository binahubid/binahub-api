-- SQL87: read-only consultation archive. Does not change bookings or send messages.
begin;
create or replace function public.admin_meeting_rows()
returns table(id uuid, starts_at timestamptz, status text, bucket text, is_today boolean, record jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 with ranked as (
  select b.*,row_number() over(partition by provider,coalesce(nullif(btrim(provider_series_uid),''),provider_uid,id::text)
   order by created_at desc,id desc) as series_order
  from public.calendar_bookings b
 ), classified as (
  select *,case
   when series_order>1 then 'history'
   when status in ('cancelled','rejected','no_show') then 'cancelled'
   when status not in ('requested','confirmed','rescheduled','completed') or status is null or start_time is null or end_time<start_time then 'review'
   when status in ('requested','confirmed','rescheduled') and coalesce(end_time,start_time)>=statement_timestamp() then 'upcoming'
   else 'history' end as bucket
  from ranked
 ) select id,start_time,status,bucket,
  series_order=1 and bucket in ('upcoming','history') and (start_time at time zone 'Asia/Jakarta')::date=(statement_timestamp() at time zone 'Asia/Jakarta')::date,
  jsonb_build_object('id',id,'title',coalesce(nullif(title,''),'Konsultasi BinaHub'),'status',coalesce(status,'unknown'),
   'attendeeName',coalesce(nullif(attendee_name,''),'-'),'attendeeEmail',coalesce(nullif(attendee_email,''),'-'),
   'eventTypeSlug',event_type_slug,'startTime',start_time,'endTime',end_time,'timeZone',coalesce(nullif(time_zone,''),'Asia/Jakarta'),
   'updatedAt',updated_at,'isUpcoming',bucket='upcoming','isSuperseded',series_order>1)
 from classified;
$$;

create or replace function public.admin_meetings_inbox(p_page integer default 0,p_search text default '',p_view text default 'upcoming',p_status text default '')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_status is null or length(p_status)>100 or p_view is null or p_view not in ('all','upcoming','today','history','cancelled','review') then raise exception 'MEETINGS_INBOX_INVALID'; end if;
 with source as materialized(select * from public.admin_meeting_rows()), filtered as (
  select * from source where (p_view='all' or (p_view='today' and is_today) or bucket=p_view)
   and (p_status='' or status=p_status)
   and (p_search='' or strpos(lower((record->>'attendeeName')||' '||(record->>'attendeeEmail')||' '||(record->>'title')||' '||coalesce(record->>'eventTypeSlug','')||' '||coalesce(status,'')),lower(p_search))>0)
 ), page_rows as (
  select * from filtered order by case when p_view in ('upcoming','today') then starts_at end asc nulls last,
   case when p_view not in ('upcoming','today') then starts_at end desc nulls last,id limit 20 offset p_page*20
 ) select jsonb_build_object('version',1,'page',p_page,'pageSize',20,'snapshotAt',statement_timestamp(),'timeZone','Asia/Jakarta',
  'total',(select count(*) from filtered),'counts',jsonb_build_object('all',(select count(*) from source),
   'upcoming',(select count(*) from source where bucket='upcoming'),'today',(select count(*) from source where is_today),
   'history',(select count(*) from source where bucket='history'),'cancelled',(select count(*) from source where bucket='cancelled'),
   'review',(select count(*) from source where bucket='review'),'waiting',(select count(*) from source where bucket='upcoming' and status='requested'),
   'completed',(select count(*) from source where status='completed' and not (record->>'isSuperseded')::boolean)),
  'statuses',coalesce((select jsonb_agg(status order by status) from (select distinct status from source where status is not null) s),'[]'::jsonb),
  'nextBooking',(select record from source where bucket='upcoming' order by starts_at,id limit 1),
  'records',coalesce((select jsonb_agg(record order by case when p_view in ('upcoming','today') then starts_at end asc nulls last,
   case when p_view not in ('upcoming','today') then starts_at end desc nulls last,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end; $$;

create or replace function public.admin_meeting_detail(p_id uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select r.record||jsonb_build_object('providerUid',b.provider_uid,'leadId',b.lead_id,'assessmentId',b.assessment_id,
  'organizerEmail',b.organizer_email,'meetingUrl',b.meeting_url,'cancellationReason',b.cancellation_reason)
 from public.admin_meeting_rows() r join public.calendar_bookings b on b.id=r.id where r.id=p_id;
$$;
revoke all on function public.admin_meeting_rows(),public.admin_meetings_inbox(integer,text,text,text),public.admin_meeting_detail(uuid) from public,anon,authenticated;
grant execute on function public.admin_meeting_rows(),public.admin_meetings_inbox(integer,text,text,text),public.admin_meeting_detail(uuid) to service_role;
commit;
