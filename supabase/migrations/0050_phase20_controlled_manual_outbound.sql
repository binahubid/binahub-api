-- Phase 20.2: manual Apollo outbound attribution. This migration never sends
-- email and never enables Apollo API calls. Links are opaque and only map to
-- an approved, auditable acquisition record on the server.

begin;

create table if not exists public.outbound_campaign_links (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.acquisition_sources(id) on delete restrict,
  campaign_id uuid not null references public.acquisition_campaigns(id) on delete restrict,
  batch_id uuid references public.prospect_import_batches(id) on delete set null,
  prospect_id uuid references public.acquisition_prospects(id) on delete set null,
  token_digest text not null unique,
  status text not null default 'active',
  is_test boolean not null default true,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  issued_by text not null,
  issued_at timestamptz not null default now(),
  constraint outbound_campaign_links_digest_valid check (token_digest ~ '^[0-9a-f]{64}$'),
  constraint outbound_campaign_links_status_valid check (status in ('active','revoked','expired')),
  constraint outbound_campaign_links_expiry_valid check (expires_at > issued_at),
  constraint outbound_campaign_links_revoke_valid check (
    status <> 'revoked' or (revoked_at is not null and revoked_by is not null and revoke_reason is not null)
  )
);

create table if not exists public.outbound_campaign_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.outbound_campaign_links(id) on delete cascade,
  journey_id uuid not null references public.inbound_journeys(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  constraint outbound_campaign_clicks_link_journey_unique unique (link_id, journey_id)
);

create index if not exists outbound_campaign_links_campaign_idx
  on public.outbound_campaign_links (campaign_id, issued_at desc);
create index if not exists outbound_campaign_links_prospect_idx
  on public.outbound_campaign_links (prospect_id, issued_at desc) where prospect_id is not null;
create index if not exists outbound_campaign_clicks_link_idx
  on public.outbound_campaign_clicks (link_id, clicked_at desc);
create index if not exists outbound_campaign_clicks_journey_idx
  on public.outbound_campaign_clicks (journey_id, clicked_at desc);

alter table public.outbound_campaign_links enable row level security;
alter table public.outbound_campaign_clicks enable row level security;

revoke all on table public.outbound_campaign_links, public.outbound_campaign_clicks from public, anon, authenticated;
grant select, insert, update on table public.outbound_campaign_links, public.outbound_campaign_clicks to service_role;

comment on table public.outbound_campaign_links is
  'Phase 20.2 opaque manual-outbound links. Raw tokens and recipient details are never stored in this table.';
comment on table public.outbound_campaign_clicks is
  'Click evidence without IP address or user-agent. The journey provides attribution and later lead linkage.';

notify pgrst, 'reload schema';

commit;
