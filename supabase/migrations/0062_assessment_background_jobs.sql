-- Durable assessment processing. New submissions only; no replay of historical assessments.
begin;
create table if not exists public.assessment_jobs (
  assessment_id uuid primary key references public.assessments(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','emailing','completed','failed','uncertain')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,
  ai_result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists assessment_jobs_pending_idx on public.assessment_jobs(available_at,created_at) where status='pending';
alter table public.assessment_jobs enable row level security;
revoke all on public.assessment_jobs from anon, authenticated;
grant all on public.assessment_jobs to service_role;

create or replace function public.enqueue_assessment_job() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.scores is null then
    insert into assessment_jobs(assessment_id) values(new.id) on conflict do nothing;
  end if;
  return new;
end $$;
revoke all on function public.enqueue_assessment_job() from public, anon, authenticated;
drop trigger if exists assessment_background_enqueue on public.assessments;
create trigger assessment_background_enqueue after insert on public.assessments
for each row execute function public.enqueue_assessment_job();

create or replace function public.claim_assessment_job(p_assessment_id uuid default null)
returns setof public.assessment_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A killed analysis can safely retry. A killed provider call must be reconciled,
  -- never automatically resent: its outcome may be unknown.
  update assessment_jobs set status='uncertain',last_error='Email outcome requires reconciliation',updated_at=now()
    where status='emailing' and updated_at < now()-interval '20 minutes';
  update assessment_jobs set status=case when attempts < 3 then 'pending' else 'failed' end,
    lease_token=null,available_at=now(),updated_at=now(),last_error='Analysis worker interrupted'
    where status='processing' and updated_at < now()-interval '20 minutes';
  return query
    update assessment_jobs j set status='processing',attempts=j.attempts+1,
      lease_token=gen_random_uuid(),updated_at=now()
    where j.assessment_id in (
      select q.assessment_id from assessment_jobs q where q.status='pending' and q.available_at<=now()
      and (p_assessment_id is null or q.assessment_id=p_assessment_id)
      order by q.created_at limit 1 for update skip locked
    ) returning j.*;
end $$;
revoke all on function public.claim_assessment_job(uuid) from public,anon,authenticated;
grant execute on function public.claim_assessment_job(uuid) to service_role;
notify pgrst,'reload schema';
commit;
