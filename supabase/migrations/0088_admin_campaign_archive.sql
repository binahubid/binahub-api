-- SQL88: read-only campaign archive. Does not send, retry, approve or delete data.
begin;
create index if not exists acquisition_campaigns_archive_idx on public.acquisition_campaigns(updated_at desc,id);
create index if not exists acquisition_prospects_campaign_archive_idx on public.acquisition_prospects(campaign_id,created_at desc,id);
create index if not exists acquisition_batches_campaign_archive_idx on public.prospect_import_batches(campaign_id,created_at desc,id);
create index if not exists acquisition_events_campaign_archive_idx on public.acquisition_events(campaign_id,created_at desc,id);
create index if not exists outbound_deliveries_campaign_archive_idx on public.outbound_email_deliveries(campaign_id,created_at desc,id);
create index if not exists inbound_journeys_campaign_archive_idx on public.inbound_journeys((first_attribution->>'utmCampaign'),last_seen_at desc,id);

create or replace function public.admin_campaign_archive_rows(p_kind text,p_campaign_id uuid default null,p_journey_id uuid default null)
returns table(id uuid,occurred_at timestamptz,status text,channel text,record jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_kind='campaigns' then
  return query select c.id,c.updated_at,c.status,s.channel,
   jsonb_build_object('id',c.id,'title',c.name,'subtitle',c.campaign_code,'context',s.name,'status',c.status,'occurredAt',c.updated_at,
    'owner',c.owner,'channel',c.channel,'sourceChannel',s.channel,'sourceStatus',s.status,'sourceActive',s.active,
    'startsOn',c.starts_on,'endsOn',c.ends_on)
   from public.acquisition_campaigns c join public.acquisition_sources s on s.id=c.source_id
   where p_campaign_id is null or c.id=p_campaign_id;
 elsif p_kind='prospects' then
  return query select p.id,p.created_at,p.validation_status,''::text,
   jsonb_build_object('id',p.id,'title',p.name,'subtitle',p.email,'context',coalesce(p.company,''),'status',p.validation_status,
    'occurredAt',p.created_at,'consentStatus',p.consent_status)
   from public.acquisition_prospects p where p.campaign_id=p_campaign_id;
 elsif p_kind='deliveries' then
  return query select d.id,d.created_at,d.status,''::text,
   jsonb_build_object('id',d.id,'title',d.name,'subtitle',d.email,'context',coalesce(d.company,''),'status',d.status,
    'occurredAt',d.created_at,'kind',d.kind,'locale',j.locale)
   from public.outbound_email_deliveries d join public.outbound_email_jobs j on j.id=d.job_id where d.campaign_id=p_campaign_id;
 elsif p_kind='batches' then
  return query select b.id,b.created_at,b.status,''::text,
   jsonb_build_object('id',b.id,'title',b.import_key,'subtitle',coalesce(b.file_name,''),'context','Impor daftar penerima',
    'status',b.status,'occurredAt',b.created_at,'totalRows',b.total_rows,'validRows',b.valid_rows,'invalidRows',b.invalid_rows,
    'duplicateRows',b.duplicate_rows,'suppressedRows',b.suppressed_rows,'promotedRows',b.promoted_rows)
   from public.prospect_import_batches b where b.campaign_id=p_campaign_id;
 elsif p_kind='events' then
  return query select e.id,e.created_at,e.event_type,''::text,
   jsonb_build_object('id',e.id,'title',e.event_type,'subtitle',e.actor,'context',left(coalesce(e.note,''),2000),'status',e.event_type,'occurredAt',e.created_at)
   from public.acquisition_events e where e.campaign_id=p_campaign_id;
 elsif p_kind='journeys' then
  return query select j.id,j.last_seen_at,
   case when exists(select 1 from public.inbound_journey_events e where e.journey_id=j.id and e.event_type in ('inquiry_submitted','assessment_submitted')) then 'converted' else 'browsing' end,
   j.first_channel,
   jsonb_build_object('id',j.id,'title',coalesce(nullif(j.first_attribution->>'utmSource',''),j.first_channel),
    'subtitle',coalesce(j.first_attribution->>'utmCampaign',''),'context',coalesce(j.first_landing_path,'/'),
    'status',case when exists(select 1 from public.inbound_journey_events e where e.journey_id=j.id and e.event_type in ('inquiry_submitted','assessment_submitted')) then 'converted' else 'browsing' end,
    'occurredAt',j.last_seen_at,'firstSeenAt',j.first_seen_at,'lastPath',j.last_path,
    'linked',exists(select 1 from public.inbound_lead_journeys l where l.journey_id=j.id))
   from public.inbound_journeys j join public.acquisition_campaigns c on c.id=p_campaign_id
   where nullif(btrim(j.first_attribution->>'utmCampaign'),'')=coalesce(nullif(btrim(c.utm_config->>'campaign'),''),lower(c.campaign_code))
    and (coalesce(btrim(c.utm_config->>'source'),'')='' or btrim(j.first_attribution->>'utmSource')=btrim(c.utm_config->>'source'))
    and (coalesce(btrim(c.utm_config->>'medium'),'')='' or btrim(j.first_attribution->>'utmMedium')=btrim(c.utm_config->>'medium'))
    and (p_journey_id is null or j.id=p_journey_id);
 elsif p_kind='journey_events' then
  return query select e.id,e.created_at,e.event_type,''::text,
   jsonb_build_object('id',e.id,'title',e.event_type,'subtitle',e.route_path,'context',array_to_string(e.module_codes,', '),
    'status',e.event_type,'occurredAt',e.created_at)
   from public.inbound_journey_events e where e.journey_id=p_journey_id
    and exists(select 1 from public.admin_campaign_archive_rows('journeys',p_campaign_id,p_journey_id));
 else raise exception 'CAMPAIGN_ARCHIVE_INVALID'; end if;
end; $$;

create or replace function public.admin_campaign_archive(p_kind text default 'campaigns',p_campaign_id uuid default null,p_journey_id uuid default null,
 p_page integer default 0,p_search text default '',p_status text default '',p_channel text default '')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_kind is null or p_kind not in ('campaigns','prospects','deliveries','batches','events','journeys','journey_events')
  or p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
  or p_status is null or length(p_status)>100 or p_channel is null or p_channel not in ('','inbound','outbound','partner','offline')
  or (p_kind<>'campaigns' and p_campaign_id is null) or (p_kind='journey_events' and p_journey_id is null)
  or (p_kind<>'journey_events' and p_journey_id is not null) or (p_kind<>'campaigns' and p_channel<>'') then raise exception 'CAMPAIGN_ARCHIVE_INVALID'; end if;
 if p_campaign_id is not null and not exists(select 1 from public.acquisition_campaigns where id=p_campaign_id) then return null; end if;
 if p_kind='journey_events' and not exists(select 1 from public.admin_campaign_archive_rows('journeys',p_campaign_id,p_journey_id)) then return null; end if;
 with source as materialized(select * from public.admin_campaign_archive_rows(p_kind,p_campaign_id,p_journey_id)),filtered as (
  select * from source where (p_status='' or status=p_status) and (p_channel='' or channel=p_channel)
   and (p_search='' or strpos(lower(concat_ws(' ',record->>'title',record->>'subtitle',record->>'context',record->>'owner',record->>'lastPath',id::text)),lower(p_search))>0)
 ),page_rows as(select * from filtered order by occurred_at desc nulls last,id limit 20 offset p_page*20)
 select jsonb_build_object('version',1,'kind',p_kind,'campaignId',p_campaign_id,'journeyId',p_journey_id,'page',p_page,'pageSize',20,
  'snapshotAt',statement_timestamp(),'total',(select count(*) from filtered),'all',(select count(*) from source),
  'statusCounts',coalesce((select jsonb_object_agg(status,n) from (select status,count(*) n from source group by status)s),'{}'::jsonb),
  'records',coalesce((select jsonb_agg(record order by occurred_at desc nulls last,id) from page_rows),'[]'::jsonb)) into result;
 return result;
end; $$;
revoke all on function public.admin_campaign_archive_rows(text,uuid,uuid),public.admin_campaign_archive(text,uuid,uuid,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_campaign_archive_rows(text,uuid,uuid),public.admin_campaign_archive(text,uuid,uuid,integer,text,text,text) to service_role;
commit;
