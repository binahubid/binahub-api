-- New free submissions only. Existing submitted reports, paid preparation,
-- organization records and real programs are not shortened or deleted here.
begin;
alter table public.pe_participant_attempts add column if not exists access_policy text;
create or replace function public.pe_apply_free_access_window() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.policy_id='pe-free3-2026-10-13-v1' and old.status='draft' and new.status='submitted' then
  new.access_policy:='free48-2026-10-28';
  new.retention_until:=new.submitted_at+interval '48 hours';
 end if;
 return new;
end; $$;
drop trigger if exists pe_apply_free_access_window on public.pe_participant_attempts;
create trigger pe_apply_free_access_window before update of status on public.pe_participant_attempts
 for each row execute function public.pe_apply_free_access_window();
revoke all on function public.pe_apply_free_access_window() from public,anon,authenticated,service_role;

create or replace function public.pe_bound_free_email_link() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
declare deadline timestamptz;
begin
 select retention_until into deadline from public.pe_participant_attempts
  where id=new.attempt_id and access_policy='free48-2026-10-28';
 if found and new.expires_at is not null then new.expires_at:=least(new.expires_at,deadline);end if;
 return new;
end; $$;
drop trigger if exists pe_bound_free_email_link on public.pe_email_links;
create trigger pe_bound_free_email_link before insert or update of expires_at on public.pe_email_links
 for each row execute function public.pe_bound_free_email_link();
revoke all on function public.pe_bound_free_email_link() from public,anon,authenticated,service_role;

create or replace function public.pe_exchange_email_link(p_id uuid,p_hash text,p_session_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare link public.pe_email_links; deadline timestamptz; policy text; window_end timestamptz;
begin
 if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'PE_INVALID_REQUEST';end if;
 select l.* into link from public.pe_email_links l join public.pe_participant_attempts a on a.id=l.attempt_id
  where l.attempt_id=p_id and l.token_hash=p_hash and l.expires_at>now() and a.retention_until>now()
  and (l.consumed_at is null or (a.access_policy='free48-2026-10-28' and l.consumed_at+interval '30 minutes'>now())) for update of l;
 if not found then raise exception 'PE_LINK_EXPIRED';end if;
 select retention_until,access_policy into deadline,policy from public.pe_participant_attempts where id=p_id;
 window_end:=least(link.expires_at,deadline,coalesce(link.consumed_at,now())+interval '30 minutes');
 update public.pe_email_links set consumed_at=coalesce(consumed_at,now()) where id=link.id;
 insert into public.pe_result_sessions(token_hash,attempt_id,expires_at) values(p_session_hash,p_id,window_end);
 insert into public.pe_delivery_events(attempt_id,event) values(p_id,'result_opened');
 return true;
end; $$;
revoke all on function public.pe_exchange_email_link(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.pe_exchange_email_link(uuid,text,text) to service_role;

create or replace function public.pe_cleanup_result_sessions() returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare n int;
begin
 delete from public.pe_result_sessions where expires_at<=now();get diagnostics n=row_count;
 -- Bounded cleanup through the existing assessment worker. Access is denied at
 -- the exact deadline even if physical cleanup runs later.
 delete from public.pe_participant_attempts where id in
  (select id from public.pe_participant_attempts where access_policy='free48-2026-10-28'
    and retention_until<=now() order by retention_until limit 100 for update skip locked);
 return n;
end; $$;
revoke all on function public.pe_cleanup_result_sessions() from public,anon,authenticated,service_role;
grant execute on function public.pe_cleanup_result_sessions() to service_role;
create or replace function public.pe_free_access_policy() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('version','free48-2026-10-28','hours',48,'sessionMinutes',30,'startsAt','submitted_at');
$$;
revoke all on function public.pe_free_access_policy() from public,anon,authenticated,service_role;
grant execute on function public.pe_free_access_policy() to service_role;
commit;
