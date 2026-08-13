-- Flexible batches: create batches table, add batch_id to teams, backfill from existing batch strings.
-- NOTE: tbos_teams.batch column is KEPT as a denormalized snapshot for DB-side RPC compatibility
-- (tbos_submit_observation reads team.batch to populate observation.batch).

begin;

-- 1. Create batches table
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.engagements(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.batches is 'Flexible batch entity per program (engagement). Teams reference batches via batch_id.';
create index if not exists batches_program_idx on public.batches (program_id);

-- 2. Add batch_id to tbos_teams (nullable initially for backfill)
alter table public.tbos_teams add column if not exists batch_id uuid references public.batches(id) on delete restrict;

-- 3. Backfill: create batch rows for each distinct (engagement_id, batch) pair
with distinct_batches as (
  select distinct engagement_id, batch
  from public.tbos_teams
  where batch is not null and engagement_id is not null
),
numbered_batches as (
  select
    db.engagement_id,
    db.batch as name,
    row_number() over (partition by db.engagement_id order by db.batch) as sort_order
  from distinct_batches db
)
insert into public.batches (program_id, name, sort_order)
select engagement_id, name, sort_order
from numbered_batches
on conflict do nothing;

-- 4. Link teams to batches
update public.tbos_teams t
set batch_id = b.id
from public.batches b
where b.program_id = t.engagement_id
  and b.name = t.batch
  and t.batch is not null
  and t.batch_id is null;

commit;
