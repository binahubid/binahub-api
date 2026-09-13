-- Allow a fresh NO-GO to supersede stale GO on stopped releases.
-- Never reopens a release. GO/conditional-GO retain every existing gate.
begin;

create or replace function public.record_pilot_go_no_go_review(
  p_release_id uuid,
  p_snapshot_id uuid,
  p_actor text,
  p_decision text,
  p_conditions jsonb,
  p_decision_note text
)
returns public.pilot_go_no_go_reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  release_record public.pilot_release_plans%rowtype;
  snapshot_record public.pilot_monitoring_snapshots%rowtype;
  before_record public.pilot_go_no_go_reviews%rowtype;
  saved public.pilot_go_no_go_reviews%rowtype;
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  normalized_note text := btrim(coalesce(p_decision_note, ''));
  normalized_conditions jsonb := coalesce(p_conditions, '[]'::jsonb);
begin
  if length(normalized_actor) < 3 then raise exception 'GO_NO_GO_ACTOR_REQUIRED' using errcode = '22023'; end if;
  if p_decision not in ('go', 'conditional_go', 'no_go') then raise exception 'GO_NO_GO_DECISION_INVALID' using errcode = '22023'; end if;
  if length(normalized_note) < 10 then raise exception 'GO_NO_GO_NOTE_REQUIRED' using errcode = '22023'; end if;
  if jsonb_typeof(normalized_conditions) <> 'array' then raise exception 'GO_NO_GO_CONDITIONS_INVALID' using errcode = '22023'; end if;
  if p_decision = 'conditional_go' and jsonb_array_length(normalized_conditions) = 0 then
    raise exception 'GO_NO_GO_CONDITIONS_REQUIRED' using errcode = '22023';
  end if;

  select * into release_record from public.pilot_release_plans where id = p_release_id for update;
  if release_record.id is null then raise exception 'PILOT_RELEASE_NOT_FOUND' using errcode = 'P0002'; end if;
  if release_record.is_mock or (
    release_record.status not in ('approved', 'scheduled')
    and not (p_decision = 'no_go' and release_record.status in ('paused', 'rolled_back'))
  ) then
    raise exception 'GO_NO_GO_APPROVED_RELEASE_REQUIRED' using errcode = '55000';
  end if;
  select * into snapshot_record from public.pilot_monitoring_snapshots where id = p_snapshot_id;
  if snapshot_record.id is null or snapshot_record.pilot_release_id is distinct from release_record.id then
    raise exception 'GO_NO_GO_SNAPSHOT_INVALID' using errcode = '55000';
  end if;

  if snapshot_record.is_mock or snapshot_record.evaluated_at < now() - interval '24 hours' then
    raise exception 'GO_NO_GO_FRESH_REAL_SNAPSHOT_REQUIRED' using errcode = '55000';
  end if;

  if p_decision in ('go', 'conditional_go') then
    if snapshot_record.is_mock or snapshot_record.evaluated_at < now() - interval '24 hours' then
      raise exception 'GO_NO_GO_FRESH_REAL_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_monitoring_policies
      where not enabled or is_mock or owner is null
    ) or (select count(*) from public.automation_monitoring_policies) <> 4 then
      raise exception 'GO_NO_GO_REAL_POLICIES_REQUIRED' using errcode = '55000';
    end if;
    if exists (select 1 from public.uat_scenarios where required and status <> 'passed') then
      raise exception 'GO_NO_GO_UAT_INCOMPLETE' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed')
        and severity = 'critical'
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then
      raise exception 'GO_NO_GO_CRITICAL_INCIDENT_OPEN' using errcode = '55000';
    end if;
  end if;

  if p_decision = 'go' then
    if snapshot_record.overall_status <> 'healthy' or jsonb_array_length(snapshot_record.blockers) > 0 then
      raise exception 'GO_NO_GO_HEALTHY_SNAPSHOT_REQUIRED' using errcode = '55000';
    end if;
    if exists (
      select 1 from public.automation_incidents
      where status not in ('resolved', 'dismissed')
        and severity in ('high', 'critical')
        and (pilot_release_id is null or pilot_release_id = release_record.id)
    ) then
      raise exception 'GO_NO_GO_HIGH_INCIDENT_OPEN' using errcode = '55000';
    end if;
  elsif p_decision = 'conditional_go' then
    if snapshot_record.overall_status not in ('healthy', 'warning')
      or exists (
        select 1 from jsonb_array_elements(snapshot_record.findings) finding
        where finding->>'severity' = 'critical'
      ) then
      raise exception 'GO_NO_GO_CONDITIONAL_SNAPSHOT_INVALID' using errcode = '55000';
    end if;
  end if;

  select * into before_record from public.pilot_go_no_go_reviews where pilot_release_id = release_record.id;
  insert into public.pilot_go_no_go_reviews (
    pilot_release_id, monitoring_snapshot_id, decision, conditions, decision_note,
    decided_by, decided_at, version
  ) values (
    release_record.id, snapshot_record.id, p_decision, normalized_conditions, normalized_note,
    normalized_actor, now(), 1
  )
  on conflict (pilot_release_id) do update
  set monitoring_snapshot_id = excluded.monitoring_snapshot_id,
      decision = excluded.decision,
      conditions = excluded.conditions,
      decision_note = excluded.decision_note,
      decided_by = excluded.decided_by,
      decided_at = excluded.decided_at,
      version = public.pilot_go_no_go_reviews.version + 1
  returning * into saved;

  insert into public.pilot_release_events (
    release_id, event_type, actor, before_snapshot, after_snapshot, note
  ) values (
    release_record.id, 'operational_review_recorded', normalized_actor,
    coalesce(to_jsonb(before_record), '{}'::jsonb), to_jsonb(saved), normalized_note
  );
  return saved;
end;
$$;

revoke all on function public.record_pilot_go_no_go_review(uuid,uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.record_pilot_go_no_go_review(uuid,uuid,text,text,jsonb,text) to service_role;
notify pgrst, 'reload schema';
commit;
