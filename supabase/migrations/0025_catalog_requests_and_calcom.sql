-- Public module requests and Cal.com booking synchronization.
-- Requires 0023 and 0024.

begin;

alter table public.inquiries
  add column if not exists role_title text,
  add column if not exists module_request_data jsonb not null default '{}'::jsonb;

create index if not exists inquiries_source_created_idx
  on public.inquiries (source, created_at desc);

create table if not exists public.calendar_bookings (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cal.com',
  provider_uid text not null,
  lead_id uuid references public.leads(id) on delete set null,
  assessment_id uuid references public.assessments(id) on delete set null,
  event_type_slug text,
  title text,
  status text not null,
  attendee_name text,
  attendee_email text,
  organizer_email text,
  start_time timestamptz,
  end_time timestamptz,
  time_zone text,
  meeting_url text,
  cancellation_reason text,
  provider_payload jsonb not null default '{}'::jsonb,
  provider_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint calendar_bookings_provider_valid check (provider in ('cal.com')),
  constraint calendar_bookings_status_valid check (
    status in ('requested', 'confirmed', 'rescheduled', 'cancelled', 'rejected', 'completed', 'no_show')
  ),
  constraint calendar_bookings_provider_uid_unique unique (provider, provider_uid)
);

create index if not exists calendar_bookings_lead_idx
  on public.calendar_bookings (lead_id, start_time desc);
create index if not exists calendar_bookings_status_idx
  on public.calendar_bookings (status, start_time);

drop trigger if exists calendar_bookings_set_updated_at on public.calendar_bookings;
create trigger calendar_bookings_set_updated_at
before update on public.calendar_bookings
for each row execute function public.set_transformation_updated_at();

create table if not exists public.calendar_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'cal.com',
  payload_hash text not null,
  trigger_event text not null,
  provider_uid text,
  processing_status text not null default 'received',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint calendar_webhook_events_provider_valid check (provider in ('cal.com')),
  constraint calendar_webhook_events_processing_status_valid
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  constraint calendar_webhook_events_payload_unique unique (provider, payload_hash)
);

create index if not exists calendar_webhook_events_status_idx
  on public.calendar_webhook_events (processing_status, received_at desc);

alter table public.calendar_bookings enable row level security;
alter table public.calendar_webhook_events enable row level security;

revoke all on table public.calendar_bookings, public.calendar_webhook_events
  from anon, authenticated;
grant select, insert, update on table public.calendar_bookings, public.calendar_webhook_events
  to service_role;

commit;
