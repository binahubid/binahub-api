begin;

create table if not exists public.ams_identity_links (
  ams_associate_id uuid primary key,
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  email text not null,
  full_name text not null,
  associate_status text not null,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ams_identity_links_email_unique
  on public.ams_identity_links(lower(email));

create table if not exists public.program_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  ams_assignment_id uuid not null,
  ams_assignee_id uuid not null unique,
  ams_associate_id uuid not null references public.ams_identity_links(ams_associate_id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete restrict,
  program_id uuid not null references public.engagements(id) on delete cascade,
  module_key text not null,
  role_key text not null,
  status text not null,
  scope jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_staff_module_key_check check (module_key ~ '^[a-z][a-z0-9_-]{1,49}$'),
  constraint program_staff_status_check check (
    status in ('invited', 'applied', 'accepted', 'declined', 'in_progress', 'completed', 'reviewed', 'withdrawn', 'cancelled')
  )
);
create index if not exists program_staff_program_idx
  on public.program_staff_assignments(program_id, module_key, status);
create index if not exists program_staff_profile_idx
  on public.program_staff_assignments(profile_id, status);

alter table public.facilitator_program_assignments
  add column if not exists staff_assignment_id uuid unique
    references public.program_staff_assignments(id) on delete set null;

alter table public.lep_speakers
  add column if not exists profile_id uuid references public.profiles(id) on delete set null,
  add column if not exists staff_assignment_id uuid unique
    references public.program_staff_assignments(id) on delete set null;

create table if not exists public.ams_integration_events (
  event_id uuid primary key,
  event_type text not null,
  occurred_at timestamptz not null,
  status text not null default 'processing'
    check (status in ('processing', 'done', 'failed')),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ams_login_tickets (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  next_path text not null default '/fasilitator/tbos',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists ams_login_tickets_expiry_idx
  on public.ams_login_tickets(expires_at)
  where consumed_at is null;

alter table public.ams_identity_links enable row level security;
alter table public.program_staff_assignments enable row level security;
alter table public.ams_integration_events enable row level security;
alter table public.ams_login_tickets enable row level security;
revoke all on table public.ams_identity_links, public.program_staff_assignments,
  public.ams_integration_events, public.ams_login_tickets from public, anon, authenticated;
grant all on table public.ams_identity_links, public.program_staff_assignments,
  public.ams_integration_events, public.ams_login_tickets to service_role;

create or replace function public.claim_ams_login_ticket(p_token_hash text)
returns table(email text, next_path text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.ams_login_tickets ticket
  set consumed_at = now()
  where ticket.token_hash = p_token_hash
    and ticket.consumed_at is null
    and ticket.expires_at > now()
  returning ticket.email, ticket.next_path;
end;
$$;
revoke all on function public.claim_ams_login_ticket(text) from public, anon, authenticated;
grant execute on function public.claim_ams_login_ticket(text) to service_role;

commit;
