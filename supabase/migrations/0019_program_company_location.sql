-- Every program already belongs to an organization. This migration adds the
-- optional delivery location requested by the program creation workflow.
alter table public.engagements
  add column if not exists location text;

alter table public.engagements
  drop constraint if exists engagements_location_length_check;

alter table public.engagements
  add constraint engagements_location_length_check
  check (location is null or char_length(btrim(location)) between 1 and 200)
  not valid;

alter table public.engagements
  validate constraint engagements_location_length_check;
