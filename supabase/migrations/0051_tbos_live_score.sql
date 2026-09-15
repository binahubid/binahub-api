-- T-BOS Live Score: server-synchronised projector timer and auditable controls.
-- The projector reads aggregate team scores through an authenticated API only;
-- participant identities and facilitator notes are never stored in these tables.

begin;

create table if not exists public.tbos_live_score_sessions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.engagements(id) on delete cascade,
  batch_id uuid references public.batches(id) on delete set null,
  title text not null default 'T-BOS Live Score',
  encouragement_message text not null default 'Tetap kompak. Setiap misi adalah kesempatan untuk naik bersama.',
  status text not null default 'ready' check (status in ('ready', 'running', 'paused', 'finished')),
  duration_seconds integer not null default 1200 check (duration_seconds between 60 and 14400),
  remaining_seconds integer not null default 1200 check (remaining_seconds between 0 and 14400),
  ends_at timestamptz,
  scores_visible boolean not null default true,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tbos_live_score_session_program_unique unique (program_id),
  constraint tbos_live_score_remaining_within_duration check (remaining_seconds <= duration_seconds),
  constraint tbos_live_score_running_has_end check (
    (status = 'running' and ends_at is not null)
    or (status <> 'running' and ends_at is null)
  )
);

create index if not exists tbos_live_score_sessions_batch_idx
  on public.tbos_live_score_sessions(batch_id);

create table if not exists public.tbos_live_score_audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tbos_live_score_sessions(id) on delete cascade,
  action text not null check (action in ('configured', 'started', 'paused', 'reset', 'finished', 'scores_shown', 'scores_hidden', 'elapsed')),
  actor text not null,
  previous_status text,
  new_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tbos_live_score_audit_session_idx
  on public.tbos_live_score_audit_log(session_id, created_at desc);

drop trigger if exists tbos_live_score_sessions_set_updated_at on public.tbos_live_score_sessions;
create trigger tbos_live_score_sessions_set_updated_at
before update on public.tbos_live_score_sessions
for each row execute function public.set_updated_at();

alter table public.tbos_live_score_sessions enable row level security;
alter table public.tbos_live_score_audit_log enable row level security;

revoke all on table public.tbos_live_score_sessions from public, anon, authenticated;
revoke all on table public.tbos_live_score_audit_log from public, anon, authenticated;
grant all on table public.tbos_live_score_sessions to service_role;
grant all on table public.tbos_live_score_audit_log to service_role;

comment on table public.tbos_live_score_sessions is
  'One authenticated projector-control session per T-BOS program. Countdown state is server authoritative.';
comment on table public.tbos_live_score_audit_log is
  'Append-only audit of T-BOS live score timer and score-visibility controls.';

notify pgrst, 'reload schema';

commit;
