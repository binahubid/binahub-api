-- ============================================================
-- Migration 0014 — Harden RLS across the whole `public` schema.
--
-- Why: The BinaHub backend (binahub-api) is the ONLY writer/reader
-- for production data and connects with the service_role key, which
-- bypasses RLS entirely. However most tables were created WITHOUT
-- `enable row level security`, and older migrations granted
-- `select ... to authenticated` / `anon`. With RLS off, anyone who
-- holds the public anon key (which ships in the web client) could
-- read/edit/delete table data directly through PostgREST.
--
-- This migration:
--   1. Turns RLS ON for every user table in `public`.
--   2. Revokes ALL privileges from `anon` and `authenticated`.
--   3. Grants ALL back to `service_role` (keeps the backend working;
--      service_role also bypasses RLS, so this is belt-and-braces).
--   4. Re-opens ONLY `profiles.select` for `authenticated`, scoped to
--      the user's own row via a RLS policy — the single direct-table
--      read the web client still performs (role checks on dashboard).
--   5. Drops the legacy open `profiles` policies from earlier
--      migrations (e.g. profiles_select_all USING(true)).
--
-- Safe to run repeatedly (idempotent). Does NOT touch `auth` schema.
-- ============================================================

begin;

-- 1. Enable RLS on every user table in the public schema.
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;

-- 2. Close door-facing roles on every table; guarantee service_role access.
-- service_role bypasses RLS, but explicit grants keep it deterministic
-- even for tables created after 0005 (which never received GRANTs).
do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('revoke all on table public.%I from anon', r.tablename);
    execute format('revoke all on table public.%I from authenticated', r.tablename);
    execute format('grant all on table public.%I to service_role', r.tablename);
  end loop;
end $$;

-- 3. The web client still reads its own profile (role checks on
-- fasilitator/peserta dashboards). Grant + scoped RLS policy.
grant select on table public.profiles to authenticated;

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_read" on public.profiles;
drop policy if exists "profiles_select_self" on public.profiles;

create policy "profiles_select_self"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

-- 4. Drop any leftover table-level default privileges that could
-- re-grant access to anon/authenticated for new public tables.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;

commit;