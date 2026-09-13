begin;

create or replace function public.record_runtime_error(
  p_fingerprint text, p_trusted boolean, p_synthetic boolean,
  p_message text, p_stack text, p_route text, p_code text, p_release text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  saved_id uuid;
  existing_id uuid;
begin
  -- Serialize anonymous quota checks so concurrent requests cannot bypass the cap.
  if not p_trusted then
    perform pg_advisory_xact_lock(hashtext('runtime_error_events_untrusted_daily_quota'));

    select id into existing_id
    from public.runtime_error_events
    where fingerprint = p_fingerprint
      and bucket = (now() at time zone 'UTC')::date;

    if existing_id is null and (
      select count(*)
      from public.runtime_error_events
      where not trusted
        and bucket = (now() at time zone 'UTC')::date
    ) >= 1000 then
      raise exception using
        errcode = 'P0001',
        message = 'RUNTIME_ERROR_DAILY_QUOTA_REACHED';
    end if;
  end if;

  -- Never silently expire unacknowledged errors. Bound housekeeping per insert.
  delete from public.runtime_error_events where id in (
    select id from public.runtime_error_events
    where status = 'acknowledged' and last_seen_at < now() - interval '30 days'
    order by last_seen_at limit 100
  );

  insert into public.runtime_error_events
    (fingerprint, trusted, synthetic, message, stack, route, code, release)
  values (p_fingerprint, p_trusted, p_synthetic, p_message, p_stack, p_route, p_code, p_release)
  on conflict (fingerprint, bucket) do update
    set occurrence_count = public.runtime_error_events.occurrence_count + 1,
        last_seen_at = now(), status = 'open', acknowledged_at = null, acknowledged_by = null
  returning id into saved_id;

  return saved_id;
end;
$$;

revoke all on function public.record_runtime_error(text,boolean,boolean,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_runtime_error(text,boolean,boolean,text,text,text,text,text)
  to service_role;

notify pgrst, 'reload schema';
commit;
