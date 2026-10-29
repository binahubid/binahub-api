-- RM v4 private, immutable draft source. Does not enable public access or sales.
begin;
create table if not exists public.rm_instrument_versions (
 version text primary key,
 manifest jsonb not null check(jsonb_typeof(manifest)='object'),
 bundle_sha256 text not null check(bundle_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 check(manifest->'metadata'->>'version'=version),
 check(manifest->'metadata'->>'status'='draft'),
 check(manifest->'metadata'->'publicEnabled'='false'::jsonb)
);
alter table public.rm_instrument_versions enable row level security;
revoke all on public.rm_instrument_versions from public,anon,authenticated,service_role;
grant select on public.rm_instrument_versions to service_role;
comment on table public.rm_instrument_versions is 'Private CEO RM source. No participant data. Draft only; no approved SJT weights or public delivery.';
commit;
