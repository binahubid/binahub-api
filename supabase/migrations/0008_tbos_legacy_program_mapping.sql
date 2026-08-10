-- Give pre-program T-BOS teams a stable global program instead of leaving them unscoped.
begin;
do $$
declare
  org record;
  legacy_id uuid;
begin
  for org in select distinct organization_id from public.tbos_teams where engagement_id is null and organization_id is not null loop
    select id into legacy_id from public.engagements where organization_id = org.organization_id and code = 'TBOS-LEGACY-' || replace(org.organization_id::text, '-', '');
    if legacy_id is null then
      insert into public.engagements (organization_id, code, title, type, status)
      values (org.organization_id, 'TBOS-LEGACY-' || replace(org.organization_id::text, '-', ''), 'T-BOS Legacy Program', 'assessment', 'archived')
      returning id into legacy_id;
    end if;
    update public.tbos_teams set engagement_id = legacy_id where organization_id = org.organization_id and engagement_id is null;
  end loop;
end $$;
commit;
