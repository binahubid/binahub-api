-- Unique team name per (program/engagement, batch) to handle the roster race condition
-- where two facilitators at different posts may type the same team name simultaneously.
-- Partial unique index: only applies while batch_id is known (backfilled rows included).
-- The database-level guard is the authoritative check; the frontend surfaces a friendly error.

begin;

-- De-duplicate any existing duplicate (engagement_id, batch_id, name) pairs before adding the index.
-- Keep the earliest created row in each group.
with ranked as (
  select
    id,
    row_number() over (
      partition by engagement_id, batch_id, coalesce(name, '')
      order by created_at, name
    ) as rn
  from public.tbos_teams
  where engagement_id is not null and batch_id is not null
)
delete from public.tbos_teams t
using ranked r
where t.id = r.id and r.rn > 1;

create unique index if not exists tbos_teams_unique_name_per_batch
  on public.tbos_teams (engagement_id, batch_id, lower(name))
  where engagement_id is not null
    and batch_id is not null
    and (name is not null and length(trim(name)) > 0);

comment on index public.tbos_teams_unique_name_per_batch is
  'One unique team name per (program/engagement, batch) to prevent duplicate team creation races.';

commit;