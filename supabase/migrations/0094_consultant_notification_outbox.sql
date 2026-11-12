-- SQL94. Run in the APP/API database after SQL93. No historical work is broadcast.
begin;
do $$ begin
  if to_regclass('public.consultant_workspaces') is null or not exists(
    select 1 from information_schema.columns where table_schema='public' and table_name='consultant_members' and column_name='ams_membership_id'
  ) then raise exception 'Run SQL94 in the APP/API database after SQL93';end if;
end; $$;
create table if not exists public.consultant_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  source_id uuid not null,
  kind text not null check(kind in ('assignment','schedule','task')),
  snapshot jsonb,
  payload jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','processing','accepted','failed','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_token uuid,lease_until timestamptz,
  error_code text,accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists consultant_notice_source on public.consultant_notification_outbox(source_id,kind,sequence desc);
create index if not exists consultant_notice_due on public.consultant_notification_outbox(available_at) where status in ('pending','processing');
alter table public.consultant_notification_outbox enable row level security;
revoke all on public.consultant_notification_outbox from public,anon,authenticated;
grant all on public.consultant_notification_outbox to service_role;
grant usage,select on sequence public.consultant_notification_outbox_sequence_seq to service_role;

create or replace function public.consultant_notice_snapshot(p_kind text,p_source uuid) returns jsonb
language sql volatile security definer set search_path=pg_catalog,public as $$
  with context as(
    select w.lead_id,w.assignee_id,0 revision,
      case when w.handoff is null then 'assigned' else 'completed' end status,null::timestamptz start_at,null::timestamptz end_at
      from public.consultant_workspaces w where p_kind='assignment' and w.lead_id=p_source
    union all
    select w.lead_id,w.assignee_id,t.revision,t.status,t.due_at,null::timestamptz
      from public.consultant_tasks t join public.consultant_workspaces w on w.lead_id=t.lead_id where p_kind='task' and t.id=p_source
    union all
    select w.lead_id,w.assignee_id,0,b.status,b.start_time,b.end_time
      from public.calendar_bookings b join public.consultant_workspaces w on w.lead_id=b.lead_id where p_kind='schedule' and b.id=p_source
  ) select to_jsonb(c)||jsonb_build_object('associate_id',m.ams_associate_id,'membership_id',m.ams_membership_id,'member_active',coalesce(m.active,false))
    from context c left join public.consultant_members m on m.user_id=c.assignee_id;
$$;

create or replace function public.consultant_notice_emit(p_kind text,p_source uuid,p_lead uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s jsonb; old_s jsonb; o public.consultant_notification_outbox; active boolean; has_previous boolean;
begin
  s:=public.consultant_notice_snapshot(p_kind,p_source);
  select snapshot into old_s from public.consultant_notification_outbox where source_id=p_source and kind=p_kind order by sequence desc limit 1;
  has_previous:=found;
  if has_previous and old_s is not distinct from s then return;end if;
  active:=s is not null and coalesce((s->>'member_active')::boolean,false) and s->>'associate_id' is not null
    and s->>'membership_id' is not null and (p_kind='assignment' and s->>'status'='assigned'
      or p_kind='task' and s->>'status'='open' or p_kind='schedule' and s->>'status' in ('confirmed','requested','rescheduled','cancelled')
        and (s->>'start_at')::timestamptz>now());
  if not has_previous and not coalesce(active,false) then return;end if;
  insert into public.consultant_notification_outbox(source_id,kind,snapshot) values(p_source,p_kind,s) returning * into o;
  update public.consultant_notification_outbox set payload=jsonb_build_object(
    'eventId',o.id,'sourceId',p_source,'leadId',p_lead,'kind',p_kind,'version',o.sequence,'active',coalesce(active,false),
    'associateId',s->>'associate_id','membershipId',s->>'membership_id','status',coalesce(s->>'status','removed'),
    'startAt',case when p_kind='assignment' then null else s->>'start_at' end) where id=o.id;
end; $$;

create or replace function public.consultant_notice_changed() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare lead uuid; source uuid; item record; user_id uuid;
begin
  if tg_table_name='consultant_workspaces' then
    lead:=case when tg_op='DELETE' then old.lead_id else new.lead_id end;
    perform public.consultant_notice_emit('assignment',lead,lead);
    for item in select id from public.consultant_tasks where lead_id=lead loop perform public.consultant_notice_emit('task',item.id,lead);end loop;
    for item in select id from public.calendar_bookings where lead_id=lead loop perform public.consultant_notice_emit('schedule',item.id,lead);end loop;
  elsif tg_table_name='consultant_members' then
    user_id:=new.user_id;
    for item in select lead_id from public.consultant_workspaces where assignee_id=user_id loop
      perform public.consultant_notice_emit('assignment',item.lead_id,item.lead_id);
      perform public.consultant_notice_emit('task',t.id,item.lead_id) from public.consultant_tasks t where t.lead_id=item.lead_id;
      perform public.consultant_notice_emit('schedule',b.id,item.lead_id) from public.calendar_bookings b where b.lead_id=item.lead_id;
    end loop;
  else
    source:=case when tg_op='DELETE' then old.id else new.id end;
    lead:=case when tg_op='DELETE' then old.lead_id else coalesce(new.lead_id,old.lead_id) end;
    if lead is not null then perform public.consultant_notice_emit(case when tg_table_name='consultant_tasks' then 'task' else 'schedule' end,source,lead);end if;
  end if;
  return null;
end; $$;
drop trigger if exists consultant_notice_workspace on public.consultant_workspaces;
create trigger consultant_notice_workspace after insert or update of assignee_id,assignment_revision,handoff or delete on public.consultant_workspaces
  for each row execute function public.consultant_notice_changed();
drop trigger if exists consultant_notice_task on public.consultant_tasks;
create trigger consultant_notice_task after insert or update of status,due_at,revision or delete on public.consultant_tasks for each row execute function public.consultant_notice_changed();
drop trigger if exists consultant_notice_schedule on public.calendar_bookings;
create trigger consultant_notice_schedule after insert or update of lead_id,status,start_time,end_time or delete on public.calendar_bookings for each row execute function public.consultant_notice_changed();
drop trigger if exists consultant_notice_member on public.consultant_members;
create trigger consultant_notice_member after update of active,ams_membership_id on public.consultant_members for each row
  when (old.active and (not new.active or new.ams_membership_id is distinct from old.ams_membership_id))
  execute function public.consultant_notice_changed();

create or replace function public.consultant_notice_payload(p_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select o.payload from public.consultant_notification_outbox o where o.id=p_id
    and o.sequence=(select max(sequence) from public.consultant_notification_outbox where source_id=o.source_id and kind=o.kind)
    and o.snapshot is not distinct from public.consultant_notice_snapshot(o.kind,o.source_id);
$$;
create or replace function public.consultant_notice_claim(p_lease uuid,p_limit integer default 5) returns setof public.consultant_notification_outbox
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.consultant_notification_outbox set status='failed',error_code='LEASE_EXPIRED',lease_token=null,lease_until=null
    where status='processing' and lease_until<now() and attempts>=8;
  return query with due as(select id from public.consultant_notification_outbox where attempts<8 and
    (status='pending' and available_at<=now() or status='processing' and lease_until<now()) order by sequence
    limit greatest(1,least(p_limit,10)) for update skip locked)
  update public.consultant_notification_outbox o set status='processing',attempts=attempts+1,lease_token=p_lease,lease_until=now()+interval '2 minutes'
    from due where o.id=due.id returning o.*;
end; $$;
create or replace function public.consultant_notice_finish(p_id uuid,p_lease uuid,p_status text,p_error text default null) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_status not in ('pending','accepted','skipped') then raise exception 'CONSULTANT_INVALID';end if;
  update public.consultant_notification_outbox set status=case when p_status='pending' and attempts>=8 then 'failed' else p_status end,
    error_code=left(p_error,80),lease_until=null,lease_token=null,
    available_at=now()+make_interval(secs=>least(3600,(30*power(2,attempts))::integer)),
    accepted_at=case when p_status='accepted' then now() else accepted_at end where id=p_id and status='processing' and lease_token=p_lease;
  return found;
end; $$;
do $$ declare f record;begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'consultant_notice_%' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end; $$;
commit;
