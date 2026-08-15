-- Unique team name per (program/engagement, batch) to handle the roster race condition
-- where two facilitators at different posts may type the same team name simultaneously.
-- Partial unique index: only applies while batch_id is known (backfilled rows included).
-- The database-level guard is the authoritative check; the frontend surfaces a friendly error.

begin;

-- Never guess which duplicate is safe to delete: observations and historical
-- rosters may reference either row. Fail explicitly and require a reviewed merge.
do $$
begin
  if exists (
    select 1
    from public.tbos_teams
    where engagement_id is not null and batch_id is not null
    group by engagement_id, batch_id, lower(btrim(name))
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate team names exist. Merge them deliberately before applying migration 0012.';
  end if;
end;
$$;

create unique index if not exists tbos_teams_unique_name_per_batch
  on public.tbos_teams (engagement_id, batch_id, lower(name))
  where engagement_id is not null
    and batch_id is not null
    and (name is not null and length(trim(name)) > 0);

comment on index public.tbos_teams_unique_name_per_batch is
  'One unique team name per (program/engagement, batch) to prevent duplicate team creation races.';

commit;
