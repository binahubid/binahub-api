-- SQL 73: explicit admin recovery after a diagnosed processing failure.
-- Apply after SQL 71 (and SQL 72 if meeting checklists are in use).
-- Does not requeue anything on installation and never resets email jobs.
begin;
create or replace function public.spin_retry_processing(p_id uuid,p_actor uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 if p_id is null or p_actor is null then raise exception 'SPIN_INVALID_REQUEST';end if;
 select * into a from public.spin_submissions where id=p_id for update;
 if not found then raise exception 'SPIN_NOT_FOUND';end if;
 if a.status='draft' then raise exception 'SPIN_INVALID_REQUEST';end if;
 -- Never overwrite a report, steal an active lease, or bypass mail deduplication.
 if a.status<>'failed' or a.report is not null
   or exists(select 1 from public.spin_mail_jobs where submission_id=p_id) then return false;end if;
 update public.spin_submissions set status='queued',attempts=0,next_attempt_at=now(),
   error_code=null,lease=null,lease_until=null,updated_at=now() where id=p_id;
 insert into public.spin_events(submission_id,event)values(p_id,'admin_processing_retry:'||p_actor::text);
 return true;
end;$$;
revoke all on function public.spin_retry_processing(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.spin_retry_processing(uuid,uuid) to service_role;
commit;
