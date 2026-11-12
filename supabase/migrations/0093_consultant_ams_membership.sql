-- SQL93: run on the APP/API database after SQL90/92 and SQL56.
-- AMS becomes the membership authority. No consent is assumed for older accounts.
begin;
do $$ begin
  if to_regclass('public.consultant_members') is null or to_regclass('public.ams_identity_links') is null then
    raise exception 'Use the BinaHub APP/API database after SQL56/90/92';
  end if;
end $$;
alter table public.consultant_members
  add column if not exists ams_associate_id uuid,
  add column if not exists ams_membership_id uuid,
  add column if not exists ams_revision integer,
  add column if not exists ams_status text,
  add column if not exists ams_associate_status text,
  add column if not exists agreement_accepted_at timestamptz,
  add column if not exists agreement_hash text,
  add column if not exists source_updated_at timestamptz;
create unique index if not exists consultant_members_ams_identity_idx on public.consultant_members(ams_associate_id) where ams_associate_id is not null;
create unique index if not exists consultant_members_ams_membership_idx on public.consultant_members(ams_membership_id) where ams_membership_id is not null;

create or replace function public.consultant_sync_team(
  p_profile uuid,p_associate uuid,p_membership uuid,p_revision integer,p_status text,
  p_accepted timestamptz,p_hash text,p_associate_status text,p_changed timestamptz,p_name text,p_email text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare old_member public.consultant_members; v_active boolean;
begin
  if p_revision is null or p_revision<1 or p_status not in ('invited','active','paused','ended','declined')
    or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_changed is null
    or p_name is null or length(btrim(p_name)) not between 1 and 200
    or p_email is null or p_email<>lower(btrim(p_email)) then raise exception 'CONSULTANT_INVALID'; end if;
  perform 1 from public.profiles where id=p_profile for update;
  if not found then raise exception 'CONSULTANT_NOT_FOUND'; end if;
  if not exists(select 1 from public.ams_identity_links l join auth.users u on u.id=l.profile_id
    where l.ams_associate_id=p_associate and l.profile_id=p_profile
      and lower(l.email)=p_email and lower(btrim(u.email))=p_email)
    then raise exception 'CONSULTANT_FORBIDDEN'; end if;
  select * into old_member from public.consultant_members where user_id=p_profile for update;
  if old_member.ams_membership_id is not null and old_member.ams_membership_id<>p_membership
    then raise exception 'CONSULTANT_FORBIDDEN'; end if;
  if old_member.ams_revision>p_revision then return jsonb_build_object('success',true,'stale',true); end if;
  if old_member.ams_revision=p_revision and (old_member.ams_status is distinct from p_status
    or old_member.agreement_hash is distinct from p_hash or old_member.agreement_accepted_at is distinct from p_accepted)
    then raise exception 'CONSULTANT_CONFLICT'; end if;
  v_active:=p_status='active' and p_associate_status='active' and p_accepted is not null;
  insert into public.consultant_members(
    user_id,display_name,email,active,updated_by,ams_associate_id,ams_membership_id,ams_revision,ams_status,
    ams_associate_status,agreement_accepted_at,agreement_hash,source_updated_at
  ) values(p_profile,p_name,p_email,v_active,p_profile,p_associate,p_membership,p_revision,p_status,
    p_associate_status,p_accepted,p_hash,p_changed)
  on conflict(user_id) do update set display_name=excluded.display_name,email=excluded.email,active=excluded.active,
    updated_at=now(),ams_associate_id=excluded.ams_associate_id,ams_membership_id=excluded.ams_membership_id,
    ams_revision=excluded.ams_revision,ams_status=excluded.ams_status,ams_associate_status=excluded.ams_associate_status,
    agreement_accepted_at=excluded.agreement_accepted_at,agreement_hash=excluded.agreement_hash,source_updated_at=excluded.source_updated_at;
  if not v_active then
    update public.consultant_messages set status='cancelled',error='CONSULTANT_ACCESS_ENDED'
      where status='queued' and envelope->>'senderId'=p_profile::text;
  end if;
  return jsonb_build_object('success',true,'active',v_active);
end; $$;
revoke all on function public.consultant_sync_team(uuid,uuid,uuid,integer,text,timestamptz,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.consultant_sync_team(uuid,uuid,uuid,integer,text,timestamptz,text,text,timestamptz,text,text) to service_role;

create or replace function public.consultant_actor(p_actor uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.profiles where id=p_actor and role='admin') then return true; end if;
  if not exists(select 1 from public.consultant_members m join public.profiles p on p.id=m.user_id
    where m.user_id=p_actor and m.active and m.ams_membership_id is not null
      and m.ams_status='active' and m.ams_associate_status='active' and m.agreement_accepted_at is not null
      and p.role in ('consultant','facilitator')) then raise exception 'CONSULTANT_FORBIDDEN'; end if;
  return false;
end; $$;

create or replace function public.consultant_ams_roster(p_user_id uuid default null)
returns table(user_id uuid,display_name text,email text)
language sql stable security definer set search_path=pg_catalog,public as $$
  select m.user_id,m.display_name,m.email from public.consultant_members m
  join public.profiles p on p.id=m.user_id
  join auth.users u on u.id=m.user_id and m.email=lower(btrim(u.email))
  where m.active and u.email_confirmed_at is not null and m.ams_membership_id is not null
    and m.ams_status='active' and m.ams_associate_status='active' and m.agreement_accepted_at is not null
    and p.role in ('admin','consultant','facilitator') and (p_user_id is null or m.user_id=p_user_id)
  order by m.display_name,m.user_id;
$$;

do $$ begin
  if to_regprocedure('public.consultant_manage_before_team(uuid,text,jsonb)') is null then
    alter function public.consultant_manage(uuid,text,jsonb) rename to consultant_manage_before_team;
  end if;
end $$;
revoke all on function public.consultant_manage_before_team(uuid,text,jsonb) from public,anon,authenticated,service_role;
create or replace function public.consultant_manage(p_actor uuid,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not public.consultant_actor(p_actor) then raise exception 'CONSULTANT_ADMIN_REQUIRED'; end if;
  if p_action='member' then raise exception 'CONSULTANT_MANAGE_IN_AMS'; end if;
  if p_action='assign' and not exists(select 1 from public.consultant_ams_roster((p_data->>'userId')::uuid))
    then raise exception 'CONSULTANT_INVALID_MEMBER'; end if;
  return public.consultant_manage_before_team(p_actor,p_action,p_data);
end; $$;
revoke all on function public.consultant_manage(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.consultant_manage(uuid,text,jsonb) to service_role;
commit;
