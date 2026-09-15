-- Phase 20.1: an immutable inbound journey layer. This only records funnel
-- evidence; it does not send mail, promote leads, or change automation mode.

begin;

create table if not exists public.inbound_journeys (
  id uuid primary key default gen_random_uuid(),
  first_attribution jsonb not null default '{}'::jsonb,
  last_attribution jsonb not null default '{}'::jsonb,
  first_channel text not null default 'direct',
  last_channel text not null default 'direct',
  first_landing_path text,
  last_path text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inbound_journeys_channel_valid check (first_channel in ('direct','organic','paid_search','paid_social','social','referral','email','other')),
  constraint inbound_journeys_last_channel_valid check (last_channel in ('direct','organic','paid_search','paid_social','social','referral','email','other')),
  constraint inbound_journeys_first_path_valid check (first_landing_path is null or (left(first_landing_path, 1) = '/' and char_length(first_landing_path) <= 2048)),
  constraint inbound_journeys_last_path_valid check (last_path is null or (left(last_path, 1) = '/' and char_length(last_path) <= 2048))
);

create table if not exists public.inbound_journey_events (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.inbound_journeys(id) on delete cascade,
  event_type text not null,
  route_path text not null,
  channel text not null,
  attribution jsonb not null default '{}'::jsonb,
  module_codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint inbound_journey_events_type_valid check (event_type in ('landing_view','catalog_view','catalog_module_selected','assessment_started','assessment_submitted','inquiry_started','inquiry_submitted','lead_linked')),
  constraint inbound_journey_events_route_valid check (left(route_path, 1) = '/' and char_length(route_path) <= 2048),
  constraint inbound_journey_events_channel_valid check (channel in ('direct','organic','paid_search','paid_social','social','referral','email','other')),
  constraint inbound_journey_events_module_codes_valid check (cardinality(module_codes) <= 20)
);

create table if not exists public.inbound_lead_journeys (
  lead_id uuid not null references public.leads(id) on delete cascade,
  journey_id uuid not null references public.inbound_journeys(id) on delete cascade,
  link_type text not null,
  linked_at timestamptz not null default now(),
  primary key (lead_id, journey_id),
  constraint inbound_lead_journeys_type_valid check (link_type in ('assessment','inquiry','catalog_request','manual'))
);

create table if not exists public.inbound_catalog_interests (
  journey_id uuid not null references public.inbound_journeys(id) on delete cascade,
  module_code text not null,
  lead_id uuid references public.leads(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  selected_at timestamptz,
  inquiry_submitted_at timestamptz,
  primary key (journey_id, module_code),
  constraint inbound_catalog_interests_code_valid check (module_code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$')
);

create index if not exists inbound_journeys_last_seen_idx on public.inbound_journeys (last_seen_at desc);
create index if not exists inbound_journey_events_journey_idx on public.inbound_journey_events (journey_id, created_at desc);
create index if not exists inbound_journey_events_created_idx on public.inbound_journey_events (created_at desc);
create index if not exists inbound_lead_journeys_journey_idx on public.inbound_lead_journeys (journey_id, linked_at desc);
create index if not exists inbound_catalog_interests_lead_idx on public.inbound_catalog_interests (lead_id, last_seen_at desc) where lead_id is not null;

alter table public.inbound_journeys enable row level security;
alter table public.inbound_journey_events enable row level security;
alter table public.inbound_lead_journeys enable row level security;
alter table public.inbound_catalog_interests enable row level security;

revoke all on table public.inbound_journeys, public.inbound_journey_events, public.inbound_lead_journeys, public.inbound_catalog_interests from public, anon, authenticated;
grant select, insert, update on table public.inbound_journeys, public.inbound_journey_events, public.inbound_lead_journeys, public.inbound_catalog_interests to service_role;

create or replace function public.record_inbound_journey_event(
  p_journey_id uuid,
  p_event_type text,
  p_route_path text,
  p_attribution jsonb,
  p_channel text,
  p_module_codes text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_journey_id uuid := coalesce(p_journey_id, gen_random_uuid());
  v_route_path text := left(btrim(coalesce(p_route_path, '')), 2048);
  v_codes text[] := coalesce(p_module_codes, '{}');
begin
  if p_event_type not in ('landing_view','catalog_view','catalog_module_selected','assessment_started','assessment_submitted','inquiry_started','inquiry_submitted','lead_linked') then
    raise exception 'INVALID_INBOUND_JOURNEY_EVENT' using errcode='22023';
  end if;
  if v_route_path !~ '^/' then
    raise exception 'INVALID_INBOUND_JOURNEY_ROUTE' using errcode='22023';
  end if;
  if p_channel not in ('direct','organic','paid_search','paid_social','social','referral','email','other') then
    raise exception 'INVALID_INBOUND_JOURNEY_CHANNEL' using errcode='22023';
  end if;
  if cardinality(v_codes) > 20 or exists (select 1 from unnest(v_codes) code where code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$') then
    raise exception 'INVALID_INBOUND_JOURNEY_MODULES' using errcode='22023';
  end if;

  insert into public.inbound_journeys (id, first_attribution, last_attribution, first_channel, last_channel, first_landing_path, last_path)
  values (v_journey_id, coalesce(p_attribution, '{}'::jsonb), coalesce(p_attribution, '{}'::jsonb), p_channel, p_channel, v_route_path, v_route_path)
  on conflict (id) do update set
    last_attribution = excluded.last_attribution,
    last_channel = excluded.last_channel,
    last_path = excluded.last_path,
    last_seen_at = now(),
    updated_at = now();

  insert into public.inbound_journey_events (journey_id, event_type, route_path, channel, attribution, module_codes)
  values (v_journey_id, p_event_type, v_route_path, p_channel, coalesce(p_attribution, '{}'::jsonb), v_codes);

  if cardinality(v_codes) > 0 then
    insert into public.inbound_catalog_interests (journey_id, module_code, selected_at)
    select v_journey_id, code, case when p_event_type in ('catalog_module_selected','inquiry_submitted') then now() else null end
    from unnest(v_codes) code
    on conflict (journey_id, module_code) do update set
      last_seen_at = now(),
      selected_at = case when excluded.selected_at is not null then excluded.selected_at else inbound_catalog_interests.selected_at end,
      inquiry_submitted_at = case when p_event_type = 'inquiry_submitted' then now() else inbound_catalog_interests.inquiry_submitted_at end;
  end if;

  return v_journey_id;
end;
$$;

create or replace function public.link_inbound_journey_to_lead(
  p_journey_id uuid,
  p_lead_id uuid,
  p_link_type text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_journey_id is null or p_lead_id is null then return; end if;
  if p_link_type not in ('assessment','inquiry','catalog_request','manual') then
    raise exception 'INVALID_INBOUND_JOURNEY_LINK_TYPE' using errcode='22023';
  end if;
  if not exists (select 1 from public.inbound_journeys where id = p_journey_id) then return; end if;

  insert into public.inbound_lead_journeys (lead_id, journey_id, link_type)
  values (p_lead_id, p_journey_id, p_link_type)
  on conflict (lead_id, journey_id) do update set link_type = excluded.link_type;

  update public.inbound_catalog_interests
  set lead_id = p_lead_id, last_seen_at = now(), inquiry_submitted_at = case when p_link_type = 'inquiry' then now() else inquiry_submitted_at end
  where journey_id = p_journey_id;
end;
$$;

revoke all on function public.record_inbound_journey_event(uuid,text,text,jsonb,text,text[]) from public, anon, authenticated;
revoke all on function public.link_inbound_journey_to_lead(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_inbound_journey_event(uuid,text,text,jsonb,text,text[]) to service_role;
grant execute on function public.link_inbound_journey_to_lead(uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';

commit;
