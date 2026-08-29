-- Phase 7: preserve Cal.com booking lineage across reschedules.

begin;

alter table public.calendar_bookings
  add column if not exists provider_series_uid text;

update public.calendar_bookings
set provider_series_uid = coalesce(
  nullif(btrim(provider_payload ->> 'iCalUID'), ''),
  provider_uid
)
where provider_series_uid is null or btrim(provider_series_uid) = '';

-- A reschedule creates a new booking UID but retains the original iCal UID.
-- Older active rows in the same series are historical, not active meetings.
update public.calendar_bookings previous
set status = 'rescheduled',
    updated_at = now()
where previous.status in ('requested', 'confirmed')
  and previous.provider_series_uid is not null
  and exists (
    select 1
    from public.calendar_bookings successor
    where successor.provider = previous.provider
      and successor.provider_series_uid = previous.provider_series_uid
      and successor.provider_uid <> previous.provider_uid
      and successor.created_at > previous.created_at
  );

create index if not exists calendar_bookings_series_idx
  on public.calendar_bookings (provider, provider_series_uid, updated_at desc)
  where provider_series_uid is not null;

comment on column public.calendar_bookings.provider_series_uid is
  'Stable Cal.com iCal UID used to connect original, rescheduled, and cancelled booking records.';

commit;
