-- Programs reuse the existing global engagements table as the program entity
-- (ADR: reuse engagements, do NOT create a parallel programs table).
-- program_modules is the per-program module on/off switch (module_key in ('tbos','lep',...)).

begin;

create table if not exists public.program_modules (
  program_id uuid not null references public.engagements(id) on delete cascade,
  module_key text not null check (module_key in ('tbos', 'lep')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (program_id, module_key)
);

comment on table public.program_modules is 'Per-program module switch. program_id maps to engagements (global program entity).';

-- Backfill: existing T-BOS programs get the 'tbos' module enabled so nothing disappears.
insert into public.program_modules (program_id, module_key, enabled)
select distinct e.id, 'tbos', true
from public.engagements e
where exists (select 1 from public.tbos_teams t where t.engagement_id = e.id)
on conflict (program_id, module_key) do nothing;

commit;
