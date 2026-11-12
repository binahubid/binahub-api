-- SQL92. New or transferred Portal assignments require current AMS verification.
-- Existing assignments and account roles are preserved. No email or AMS project invitation is created.
begin;

create or replace function public.consultant_ams_roster(p_user_id uuid default null)
returns table(user_id uuid,display_name text,email text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select m.user_id,m.display_name,m.email
  from public.consultant_members m
  join public.profiles p on p.id=m.user_id
  join auth.users u on u.id=m.user_id and m.email=lower(btrim(u.email))
  where m.active and u.email_confirmed_at is not null
    and p.role in ('admin','consultant','facilitator')
    and (p_user_id is null or m.user_id=p_user_id)
  order by m.display_name,m.user_id;
$$;
revoke all on function public.consultant_ams_roster(uuid) from public, anon, authenticated;
grant execute on function public.consultant_ams_roster(uuid) to service_role;

create or replace function public.consultant_manage(p_actor uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.consultant_workspaces; target uuid; lead uuid; current_email text;
begin
  perform 1 from public.profiles where id=p_actor for share;
  if not public.consultant_actor(p_actor) then raise exception 'CONSULTANT_ADMIN_REQUIRED'; end if;
  if p_action='member' then
    target:=(p_data->>'userId')::uuid;
    perform 1 from public.profiles where id=target and role in ('admin','facilitator','consultant') for share;
    if not found then raise exception 'CONSULTANT_INVALID_MEMBER'; end if;
    select lower(email) into current_email from auth.users where id=target;
    if current_email is null or length(btrim(p_data->>'name')) not between 1 and 200 then raise exception 'CONSULTANT_INVALID'; end if;
    insert into public.consultant_members(user_id,display_name,email,active,updated_by)
      values(target,p_data->>'name',current_email,(p_data->>'active')::boolean,p_actor)
      on conflict(user_id) do update set display_name=excluded.display_name,email=excluded.email,
        active=excluded.active,updated_by=p_actor,updated_at=now();
    if not (p_data->>'active')::boolean then
      if exists(select 1 from public.consultant_messages where (created_by=target or envelope->>'senderId'=target::text) and status='processing' and lease_until>now())
        then raise exception 'CONSULTANT_SEND_IN_FLIGHT'; end if;
      update public.consultant_messages set status='cancelled',error='CONSULTANT_ACCESS_ENDED' where (created_by=target or envelope->>'senderId'=target::text) and status='queued';
    end if;
    return jsonb_build_object('success',true);
  elsif p_action='assign' then
    lead:=(p_data->>'leadId')::uuid; target:=(p_data->>'userId')::uuid;
    perform 1 from public.profiles where id=target and role in ('admin','consultant','facilitator') for share;
    if not found then raise exception 'CONSULTANT_INVALID_MEMBER'; end if;
    select m.email into current_email from public.consultant_members m
      join auth.users u on u.id=m.user_id and m.email=lower(btrim(u.email))
      where m.user_id=target and m.active and u.email_confirmed_at is not null for share of m,u;
    if not found then raise exception 'CONSULTANT_INVALID_MEMBER'; end if;
    -- These fields are added by the API after a current, signed AMS lookup.
    if current_email is distinct from (p_data->>'verifiedAmsEmail')
      or coalesce(p_data->>'amsAssociateId','') !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'
      then raise exception 'CONSULTANT_AMS_REQUIRED'; end if;
    perform 1 from public.leads where id=lead for update;
    if not found then raise exception 'CONSULTANT_NOT_FOUND'; end if;
    insert into public.consultant_workspaces(lead_id) values(lead) on conflict do nothing;
    select * into w from public.consultant_workspaces where lead_id=lead for update;
    if w.version is distinct from (p_data->>'version')::integer then raise exception 'CONSULTANT_CONFLICT'; end if;
    if w.assignee_id=target then return jsonb_build_object('success',true); end if;
    if exists(select 1 from public.consultant_messages where lead_id=lead and status='processing' and lease_until>now())
      then raise exception 'CONSULTANT_SEND_IN_FLIGHT'; end if;
    update public.consultant_workspaces set assignee_id=target,assignment_revision=assignment_revision+1,
      version=version+1,updated_by=p_actor,updated_at=now() where lead_id=lead;
    update public.consultant_messages set status='cancelled',error='ASSIGNMENT_CHANGED' where lead_id=lead and status='queued';
    update public.leads set opportunity_owner=current_email,outreach_paused=true,outreach_pause_reason='Ditangani konsultan',
      outreach_paused_by=p_actor::text,outreach_paused_at=now(),pipeline_updated_at=now() where id=lead;
    perform public.consultant_event(p_actor,lead,'owner_assigned',coalesce(p_data->>'note','Penanggung jawab konsultasi diperbarui.'));
    return jsonb_build_object('success',true);
  elsif p_action='booking' then
    lead:=(p_data->>'leadId')::uuid;
    perform 1 from public.leads where id=lead;
    if not found then raise exception 'CONSULTANT_NOT_FOUND'; end if;
    update public.calendar_bookings set lead_id=lead where id=(p_data->>'bookingId')::uuid and lead_id is null;
    if not found then raise exception 'CONSULTANT_CONFLICT'; end if;
    perform public.consultant_event(p_actor,lead,'booking_linked','Jadwal dihubungkan oleh admin.');
    return jsonb_build_object('success',true);
  end if;
  raise exception 'CONSULTANT_INVALID';
end; $$;

create or replace function public.consultant_sync_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; w public.consultant_workspaces;
begin
  if new.opportunity_owner is not distinct from old.opportunity_owner then return new; end if;
  select m.user_id into target from public.consultant_members m join public.profiles p on p.id=m.user_id
    where m.active and m.email=lower(btrim(new.opportunity_owner)) and p.role in ('admin','consultant','facilitator');
  select * into w from public.consultant_workspaces where lead_id=new.id for update;
  if w.assignee_id is not distinct from target then return new; end if;
  -- The old free-text Pipeline field must not create or transfer a Portal assignment.
  -- consultant_manage updates the workspace before updating opportunity_owner.
  if target is not null then raise exception 'CONSULTANT_ASSIGN_VIA_PORTAL'; end if;
  if not found then return new; end if;
  if exists(select 1 from public.consultant_messages where lead_id=new.id and status='processing' and lease_until>now())
    then raise exception 'CONSULTANT_SEND_IN_FLIGHT'; end if;
  update public.consultant_workspaces set assignee_id=target,assignment_revision=assignment_revision+1,
    version=version+1,updated_at=now() where lead_id=new.id;
  update public.consultant_messages set status='cancelled',error='ASSIGNMENT_CHANGED' where lead_id=new.id and status='queued';
  new.outreach_paused:=true; new.outreach_pause_reason:='Penugasan konsultasi diperbarui';
  return new;
end; $$;

commit;
