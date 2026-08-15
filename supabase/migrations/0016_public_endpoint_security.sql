-- Persistent abuse controls and ownership data for anonymous-facing endpoints.

begin;

create table if not exists public.api_rate_limits (
  key_hash text primary key,
  request_count integer not null default 0 check (request_count >= 0),
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists api_rate_limits_expiry_idx on public.api_rate_limits(expires_at);

revoke all on table public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limits to service_role;
alter table public.api_rate_limits enable row level security;

create or replace function public.consume_api_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash is null or btrim(p_key_hash) = ''
    or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400
  then
    raise exception using errcode = '22023', message = 'Konfigurasi rate limit tidak valid.';
  end if;

  delete from public.api_rate_limits
  where key_hash in (
    select key_hash
    from public.api_rate_limits
    where expires_at < v_now
    order by expires_at
    limit 100
  );

  insert into public.api_rate_limits (key_hash, request_count, window_started_at, expires_at)
  values (p_key_hash, 1, v_now, v_now + make_interval(secs => p_window_seconds))
  on conflict (key_hash) do update set
    request_count = case
      when public.api_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then 1
      else public.api_rate_limits.request_count + 1
    end,
    window_started_at = case
      when public.api_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds) then v_now
      else public.api_rate_limits.window_started_at
    end,
    expires_at = case
      when public.api_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        then v_now + make_interval(secs => p_window_seconds)
      else public.api_rate_limits.expires_at
    end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  messages jsonb not null default '[]'::jsonb,
  session_secret_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chat_sessions add column if not exists session_secret_hash text;
alter table public.chat_sessions add column if not exists expires_at timestamptz;
update public.chat_sessions
set session_secret_hash = coalesce(session_secret_hash, encode(digest(gen_random_uuid()::text, 'sha256'), 'hex')),
    expires_at = coalesce(expires_at, now() + interval '30 days')
where session_secret_hash is null or expires_at is null;
alter table public.chat_sessions alter column session_secret_hash set not null;
alter table public.chat_sessions alter column expires_at set default (now() + interval '30 days');
alter table public.chat_sessions alter column expires_at set not null;

create index if not exists chat_sessions_expiry_idx on public.chat_sessions(expires_at);

revoke all on table public.chat_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_sessions to service_role;
alter table public.chat_sessions enable row level security;

alter table public.app_client_access_codes
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists app_client_access_codes_auth_user_unique
  on public.app_client_access_codes(auth_user_id) where auth_user_id is not null;

commit;
