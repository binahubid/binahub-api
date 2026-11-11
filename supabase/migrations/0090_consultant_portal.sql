-- SQL90. Consultant work is readable by the team; mutations require assignment.
-- Run on the API database after SQL72/85/87. No messages are sent by this migration.
begin;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin','facilitator','client','peserta','consultant')) not valid;

create table if not exists public.consultant_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  email text not null check (length(email) between 3 and 320 and email=lower(btrim(email))),
  active boolean not null default true,
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.consultant_workspaces (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  assignee_id uuid references public.profiles(id) on delete set null,
  assignment_revision integer not null default 0,
  version integer not null default 0,
  checklist_revision integer not null default 0,
  source_id uuid references public.spin_submissions(id) on delete set null,
  original_answers jsonb not null default '{}',
  answers jsonb not null default '{}',
  notes text not null default '' check (length(notes)<=4000),
  checklist_status text not null default 'in_progress' check (checklist_status in ('in_progress','completed')),
  handoff jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(original_answers)='object' and jsonb_typeof(answers)='object'),
  check (octet_length(answers::text)<=20000 and octet_length(original_answers::text)<=20000)
);
create table if not exists public.consultant_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 240),
  due_at timestamptz not null,
  status text not null default 'open' check (status in ('open','completed')),
  revision integer not null default 1,
  created_by uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.consultant_proposals (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  revision integer not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  checklist_revision integer not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=100000),
  status text not null default 'draft' check (status in ('draft','sent')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(lead_id,revision), unique(lead_id,input_hash)
);
create table if not exists public.consultant_messages (
  id uuid primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  proposal_id uuid references public.consultant_proposals(id),
  kind text not null check (kind in ('proposal','follow_up')),
  assignment_revision integer not null,
  created_by uuid not null,
  envelope jsonb not null check (jsonb_typeof(envelope)='object' and octet_length(envelope::text)<=24000),
  scheduled_at timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','accepted','failed','cancelled','uncertain')),
  lease_token uuid,
  lease_until timestamptz,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists consultant_tasks_due_idx on public.consultant_tasks(status,due_at);
create index if not exists consultant_tasks_lead_idx on public.consultant_tasks(lead_id,due_at);
create index if not exists consultant_messages_due_idx on public.consultant_messages(status,scheduled_at);
create index if not exists consultant_messages_lead_idx on public.consultant_messages(lead_id,created_at desc);
create index if not exists consultant_workspaces_assignee_idx on public.consultant_workspaces(assignee_id);

create or replace function public.consultant_actor(p_actor uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare admin_actor boolean;
begin
  select role='admin' into admin_actor from public.profiles where id=p_actor;
  if coalesce(admin_actor,false) then return true; end if;
  if not exists(select 1 from public.consultant_members m join public.profiles p on p.id=m.user_id
    where m.user_id=p_actor and m.active and p.role in ('consultant','facilitator'))
    then raise exception 'CONSULTANT_FORBIDDEN'; end if;
  return false;
end; $$;

create or replace function public.consultant_lock_work(p_actor uuid,p_lead uuid,p_version integer)
returns public.consultant_workspaces language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.consultant_workspaces; admin_actor boolean;
begin
  perform 1 from public.profiles where id=p_actor for share;
  admin_actor:=public.consultant_actor(p_actor);
  -- Serialize deactivation with in-flight mutations for this account.
  perform 1 from public.consultant_members where user_id=p_actor for share;
  admin_actor:=public.consultant_actor(p_actor);
  perform 1 from public.leads where id=p_lead for update;
  select * into w from public.consultant_workspaces where lead_id=p_lead for update;
  if not found then raise exception 'CONSULTANT_NOT_FOUND'; end if;
  if not admin_actor and w.assignee_id is distinct from p_actor then raise exception 'CONSULTANT_NOT_ASSIGNED'; end if;
  if w.version is distinct from p_version then raise exception 'CONSULTANT_CONFLICT'; end if;
  return w;
end; $$;

create or replace function public.consultant_event(p_actor uuid,p_lead uuid,p_event text,p_note text)
returns void language sql security definer set search_path=pg_catalog,public as $$
  insert into public.opportunity_activities(lead_id,event_type,actor,note)
    values(p_lead,p_event,p_actor::text,left(p_note,4000));
$$;

create or replace function public.consultant_lead_record(p_lead uuid,p_actor uuid)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',l.id,'name',l.name,'company',coalesce(l.company,''),'email',l.email,'phone',coalesce(l.phone,''),
    'stage',coalesce(l.opportunity_stage,'identified'),'nextAction',l.next_action,'nextActionDueAt',l.next_action_due_at,
    'assigneeId',w.assignee_id,'assigneeName',coalesce(m.display_name,p.full_name,l.opportunity_owner,'Belum ditugaskan'),
    'version',coalesce(w.version,0),'assignmentRevision',coalesce(w.assignment_revision,0),
    'canEdit',coalesce((select role='admin' from public.profiles where id=p_actor),false) or coalesce(w.assignee_id=p_actor,false),
    'checklistStatus',coalesce(w.checklist_status,'in_progress'),'handoff',w.handoff,'updatedAt',coalesce(w.updated_at,l.created_at)
  ) from public.leads l left join public.consultant_workspaces w on w.lead_id=l.id
    left join public.consultant_members m on m.user_id=w.assignee_id
    left join public.profiles p on p.id=w.assignee_id where l.id=p_lead;
$$;

create or replace function public.consultant_portal_read(
  p_actor uuid,p_page integer default 0,p_search text default '',p_owner text default 'all',p_view text default 'all')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb; admin_actor boolean;
begin
  admin_actor:=public.consultant_actor(p_actor);
  if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150
    or p_owner is null or (p_owner not in ('all','mine','unassigned') and p_owner !~ '^[a-f0-9-]{36}$')
    or p_view is null or p_view not in ('all','active','won','lost','handoff') then raise exception 'CONSULTANT_INVALID'; end if;
  with filtered as materialized (
    select l.id from public.leads l left join public.consultant_workspaces w on w.lead_id=l.id
    where (p_owner='all' or p_owner='mine' and w.assignee_id=p_actor
      or p_owner='unassigned' and w.assignee_id is null or w.assignee_id::text=p_owner)
      and (p_search='' or strpos(lower(concat_ws(' ',l.name,l.company,l.email,l.opportunity_owner)),lower(p_search))>0)
      and (p_view='all' or p_view='active' and coalesce(l.opportunity_stage,'identified') not in ('won','lost')
        or p_view in ('won','lost') and l.opportunity_stage=p_view or p_view='handoff' and w.handoff is not null)
  ), page_rows as (
    select l.id from public.leads l join filtered f on f.id=l.id
    order by l.next_action_due_at asc nulls last,l.created_at desc,l.id limit 20 offset p_page*20
  ) select jsonb_build_object('page',p_page,'pageSize',20,'total',(select count(*) from filtered),
    'actorId',p_actor,'isAdmin',admin_actor,
    'records',coalesce((select jsonb_agg(public.consultant_lead_record(id,p_actor)) from page_rows),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.display_name,'active',m.active and p.role in ('admin','consultant','facilitator')) order by m.display_name)
      from public.consultant_members m join public.profiles p on p.id=m.user_id),'[]'::jsonb),
    'summary',jsonb_build_object(
      'opportunities',(select count(*) from filtered),
      'active',(select count(*) from public.leads l join filtered f on f.id=l.id where coalesce(l.opportunity_stage,'identified') not in ('won','lost')),
      'overdue',(select count(*) from public.consultant_tasks t join filtered f on f.id=t.lead_id where t.status='open' and t.due_at<now()),
      'proposals',(select count(*) from public.consultant_proposals r join filtered f on f.id=r.lead_id where r.status='draft'),
      'handoffs',(select count(*) from public.consultant_workspaces w join filtered f on f.id=w.lead_id where w.handoff is not null)),
    'tasks',coalesce((select jsonb_agg(v order by v->>'due_at') from (
      select to_jsonb(t)||jsonb_build_object('company',coalesce(l.company,l.name),'assigneeId',w.assignee_id,
        'assigneeName',coalesce(m.display_name,p.full_name,'Belum ditugaskan')) v
      from public.consultant_tasks t join filtered f on f.id=t.lead_id join public.leads l on l.id=t.lead_id
      join public.consultant_workspaces w on w.lead_id=t.lead_id left join public.consultant_members m on m.user_id=w.assignee_id
      left join public.profiles p on p.id=w.assignee_id where t.status='open' order by t.due_at limit 100) q),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(v order by v->>'startTime') from (
      select jsonb_build_object('id',b.id,'leadId',b.lead_id,'title',b.title,'name',b.attendee_name,
        'startTime',b.start_time,'endTime',b.end_time,'status',b.status,'meetingUrl',b.meeting_url,
        'assigneeId',w.assignee_id,'assigneeName',coalesce(m.display_name,p.full_name,'Belum ditugaskan')) v
      from public.calendar_bookings b join filtered f on f.id=b.lead_id
      left join public.consultant_workspaces w on w.lead_id=b.lead_id left join public.consultant_members m on m.user_id=w.assignee_id
      left join public.profiles p on p.id=w.assignee_id where b.status in ('confirmed','rescheduled','requested') and b.end_time>=now()
      order by b.start_time limit 100) q),'[]'::jsonb)) into result;
  return result;
end; $$;

create or replace function public.consultant_portal_detail(p_actor uuid,p_lead uuid,p_history_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.consultant_actor(p_actor);
  if p_history_page is null or p_history_page not between 0 and 10000 then raise exception 'CONSULTANT_INVALID'; end if;
  if not exists(select 1 from public.leads where id=p_lead) then raise exception 'CONSULTANT_NOT_FOUND'; end if;
  select jsonb_build_object('record',public.consultant_lead_record(p_lead,p_actor),
    'workspace',(select to_jsonb(w) from public.consultant_workspaces w where lead_id=p_lead),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by t.due_at) from public.consultant_tasks t where t.lead_id=p_lead),'[]'::jsonb),
    'proposals',coalesce((select jsonb_agg(to_jsonb(r) order by r.revision desc) from public.consultant_proposals r where r.lead_id=p_lead),'[]'::jsonb),
    'messages',coalesce((select jsonb_agg(to_jsonb(e)-'lease_token'-'lease_until' order by e.created_at desc) from public.consultant_messages e where e.lead_id=p_lead),'[]'::jsonb),
    'activities',coalesce((select jsonb_agg(to_jsonb(a)-'metadata' order by a.created_at desc) from (
      select * from public.opportunity_activities where lead_id=p_lead order by created_at desc,id desc limit 30 offset p_history_page*30) a),'[]'::jsonb),
    'activityTotal',(select count(*) from public.opportunity_activities where lead_id=p_lead),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'submittedAt',s.submitted_at,'company',s.contact->>'company') order by s.submitted_at desc)
      from public.spin_submissions s join public.leads l on lower(s.contact->>'email')=lower(l.email)
      where l.id=p_lead and s.submitted_at is not null),'[]'::jsonb),
    'bookings',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'title',b.title,'startTime',b.start_time,
      'endTime',b.end_time,'status',b.status,'meetingUrl',b.meeting_url) order by b.start_time desc)
      from public.calendar_bookings b where b.lead_id=p_lead),'[]'::jsonb)) into result;
  return result;
end; $$;

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
    select email into current_email from public.consultant_members where user_id=target and active for share;
    if not found then raise exception 'CONSULTANT_INVALID_MEMBER'; end if;
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

create or replace function public.consultant_save_work(p_actor uuid,p_lead uuid,p_version integer,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.consultant_workspaces; s public.spin_submissions; item uuid; event_name text; event_note text;
begin
  w:=public.consultant_lock_work(p_actor,p_lead,p_version);
  if p_action in ('meeting','source','activity','stage','handoff') and exists(select 1 from public.consultant_messages
    where lead_id=p_lead and status='processing' and lease_until>now()) then raise exception 'CONSULTANT_SEND_IN_FLIGHT'; end if;
  if p_action='meeting' then
    if p_data->>'status' not in ('in_progress','completed') or jsonb_typeof(p_data->'answers')<>'object'
      or length(p_data->>'notes')>4000 then raise exception 'CONSULTANT_INVALID'; end if;
    update public.consultant_workspaces set answers=p_data->'answers',notes=p_data->>'notes',checklist_status=p_data->>'status' where lead_id=p_lead;
    update public.consultant_workspaces set checklist_revision=checklist_revision+1 where lead_id=p_lead;
    update public.consultant_messages set status='cancelled',error='NEEDS_CHANGED' where lead_id=p_lead and status='queued' and proposal_id is not null;
    event_name:='consultation_saved'; event_note:='Kebutuhan konsultasi diperbarui.';
  elsif p_action='source' then
    if w.answers<>'{}'::jsonb or w.checklist_status='completed' then raise exception 'CONSULTANT_SOURCE_LOCKED'; end if;
    select s0.* into s from public.spin_submissions s0 join public.leads l on lower(l.email)=lower(s0.contact->>'email')
      where s0.id=(p_data->>'sourceId')::uuid and l.id=p_lead and s0.submitted_at is not null;
    if not found or s.question_version<>'spin-v3.2-ceo-2026-10-22' then raise exception 'CONSULTANT_INVALID_SOURCE'; end if;
    update public.consultant_workspaces set source_id=s.id,original_answers=s.answers where lead_id=p_lead;
    update public.consultant_workspaces set checklist_revision=checklist_revision+1 where lead_id=p_lead;
    event_name:='consultation_source_linked'; event_note:='Jawaban klien dihubungkan ke konsultasi.';
  elsif p_action='task' then
    if length(btrim(p_data->>'title')) not between 1 and 240 or p_data->>'dueAt' is null then raise exception 'CONSULTANT_INVALID'; end if;
    item:=(p_data->>'id')::uuid;
    insert into public.consultant_tasks(id,lead_id,title,due_at,created_by)
      values(item,p_lead,p_data->>'title',(p_data->>'dueAt')::timestamptz,p_actor);
    update public.leads set next_action=p_data->>'title',next_action_due_at=(p_data->>'dueAt')::timestamptz,pipeline_updated_at=now() where id=p_lead;
    event_name:='next_action_updated'; event_note:=p_data->>'title';
  elsif p_action='complete_task' then
    update public.consultant_tasks set status='completed',completed_at=now(),revision=revision+1
      where id=(p_data->>'taskId')::uuid and lead_id=p_lead and revision=(p_data->>'revision')::integer and status='open';
    if not found then raise exception 'CONSULTANT_CONFLICT'; end if;
    update public.leads set (next_action,next_action_due_at)=(select title,due_at from public.consultant_tasks
      where lead_id=p_lead and status='open' order by due_at,id limit 1),pipeline_updated_at=now() where id=p_lead;
    event_name:='consultant_task_completed'; event_note:='Tugas ditandai selesai.';
  elsif p_action='activity' then
    if length(btrim(p_data->>'note')) not between 1 and 4000 then raise exception 'CONSULTANT_INVALID'; end if;
    update public.consultant_messages set status='cancelled',error='CONVERSATION_UPDATED' where lead_id=p_lead and status='queued' and kind='follow_up';
    event_name:='consultation_activity'; event_note:=p_data->>'note';
  elsif p_action='stage' then
    if p_data->>'stage' not in ('identified','qualified','consultation','proposal','negotiation','won','lost') then raise exception 'CONSULTANT_INVALID'; end if;
    if p_data->>'stage'='lost' and coalesce(length(btrim(p_data->>'note')),0)=0 then raise exception 'CONSULTANT_INVALID'; end if;
    update public.leads set opportunity_stage=p_data->>'stage',lost_reason=case when p_data->>'stage'='lost' then p_data->>'note' else null end,
      won_at=case when p_data->>'stage'='won' then now() else won_at end,
      lost_at=case when p_data->>'stage'='lost' then now() else lost_at end,pipeline_updated_at=now() where id=p_lead;
    if p_data->>'stage' in ('won','lost') then
      update public.consultant_messages set status='cancelled',error='OPPORTUNITY_CLOSED' where lead_id=p_lead and status='queued';
    end if;
    event_name:='stage_changed'; event_note:=coalesce(p_data->>'note','Tahap peluang diperbarui.');
  elsif p_action='cancel_message' then
    update public.consultant_messages set status='cancelled',error='CANCELLED_BY_OWNER' where id=(p_data->>'messageId')::uuid and lead_id=p_lead and status='queued';
    if not found then raise exception 'CONSULTANT_CONFLICT'; end if;
    event_name:='consultant_message_cancelled'; event_note:='Pesan terjadwal dibatalkan.';
  elsif p_action='handoff' then
    select id into item from public.consultant_proposals where lead_id=p_lead and status='sent' and checklist_revision=w.checklist_revision order by revision desc limit 1;
    if item is null then raise exception 'CONSULTANT_PROPOSAL_REQUIRED'; end if;
    update public.consultant_workspaces set handoff=jsonb_build_object('proposalId',item,'note',left(p_data->>'note',4000),'requestedAt',now(),'requestedBy',p_actor) where lead_id=p_lead;
    update public.leads set opportunity_stage='won',won_at=coalesce(won_at,now()),pipeline_updated_at=now() where id=p_lead;
    update public.consultant_messages set status='cancelled',error='HANDOFF_REQUESTED' where lead_id=p_lead and status='queued';
    event_name:='consultation_handoff'; event_note:='Ringkasan serah terima disiapkan untuk admin.';
  elsif p_action='replacement' then
    event_name:='consultant_replacement_requested'; event_note:=coalesce(p_data->>'note','Memerlukan konsultan pengganti.');
  else raise exception 'CONSULTANT_INVALID'; end if;
  update public.consultant_workspaces set version=version+1,updated_by=p_actor,updated_at=now() where lead_id=p_lead;
  perform public.consultant_event(p_actor,p_lead,event_name,event_note);
  return jsonb_build_object('success',true);
end; $$;

create or replace function public.consultant_store_proposal(p_actor uuid,p_lead uuid,p_version integer,p_hash text,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.consultant_workspaces; r public.consultant_proposals;
begin
  w:=public.consultant_lock_work(p_actor,p_lead,p_version);
  if w.checklist_status<>'completed' then raise exception 'CONSULTANT_CHECKLIST_REQUIRED'; end if;
  select * into r from public.consultant_proposals where lead_id=p_lead and input_hash=p_hash;
  if found then return to_jsonb(r); end if;
  insert into public.consultant_proposals(lead_id,revision,input_hash,checklist_revision,snapshot,created_by)
    select p_lead,coalesce(max(revision),0)+1,p_hash,w.checklist_revision,p_snapshot,p_actor from public.consultant_proposals where lead_id=p_lead returning * into r;
  perform public.consultant_event(p_actor,p_lead,'consultant_proposal_created','Draf proposal disiapkan.');
  return to_jsonb(r);
end; $$;

create or replace function public.consultant_queue_message(p_actor uuid,p_lead uuid,p_version integer,p_id uuid,p_proposal uuid,p_kind text,p_envelope jsonb,p_scheduled timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.consultant_workspaces; m public.consultant_messages;
begin
  w:=public.consultant_lock_work(p_actor,p_lead,p_version);
  if w.assignee_id is null or p_kind not in ('proposal','follow_up') or p_scheduled is null
    or p_scheduled>now()+interval '1 year' then raise exception 'CONSULTANT_INVALID'; end if;
  if exists(select 1 from public.leads where id=p_lead and opportunity_stage in ('won','lost')) then raise exception 'CONSULTANT_CLOSED'; end if;
  if p_proposal is not null and not exists(select 1 from public.consultant_proposals where id=p_proposal and lead_id=p_lead)
    then raise exception 'CONSULTANT_INVALID'; end if;
  if p_kind='proposal' and p_proposal is null then raise exception 'CONSULTANT_PROPOSAL_REQUIRED'; end if;
  if p_proposal is not null and not exists(select 1 from public.consultant_proposals where id=p_proposal and checklist_revision=w.checklist_revision)
    then raise exception 'CONSULTANT_STALE_PROPOSAL'; end if;
  select * into m from public.consultant_messages where id=p_id;
  if found then
    if m.lead_id<>p_lead or m.created_by<>p_actor or m.envelope<>p_envelope or m.proposal_id is distinct from p_proposal
      or m.kind<>p_kind or m.scheduled_at<>p_scheduled then raise exception 'CONSULTANT_CONFLICT'; end if;
    return to_jsonb(m)-'lease_token'-'lease_until';
  end if;
  insert into public.consultant_messages(id,lead_id,proposal_id,kind,assignment_revision,created_by,envelope,scheduled_at)
    values(p_id,p_lead,p_proposal,p_kind,w.assignment_revision,p_actor,p_envelope,p_scheduled) returning * into m;
  perform public.consultant_event(p_actor,p_lead,'consultant_message_queued','Pesan dijadwalkan setelah ditinjau.');
  return to_jsonb(m)-'lease_token'-'lease_until';
end; $$;

create or replace function public.consultant_expire_messages()
returns void language sql security definer set search_path=pg_catalog,public as $$
  update public.consultant_messages set status='uncertain',error='PROCESSING_INTERRUPTED'
    where status='processing' and lease_until<now();
$$;

create or replace function public.consultant_claim_message(p_lease uuid,p_id uuid default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.consultant_messages; w public.consultant_workspaces; owner_id uuid;
begin
  for m in select * from public.consultant_messages where status='queued' and scheduled_at<=now()
    and (p_id is null or id=p_id) order by scheduled_at,created_at limit 10 loop
    select assignee_id into owner_id from public.consultant_workspaces where lead_id=m.lead_id;
    perform 1 from public.profiles where id in (owner_id,m.created_by) order by id for share;
    perform 1 from public.consultant_members where user_id=owner_id for share;
    perform 1 from public.leads where id=m.lead_id for update skip locked;
    if not found then continue; end if;
    select * into w from public.consultant_workspaces where lead_id=m.lead_id for update skip locked;
    if not found then continue; end if;
    if w.assignee_id is distinct from owner_id then continue; end if;
    select * into m from public.consultant_messages where id=m.id and status='queued' for update skip locked;
    if not found then continue; end if;
    if w.assignment_revision<>m.assignment_revision or not exists(select 1 from public.consultant_members cm join public.profiles cp on cp.id=cm.user_id
        where cm.user_id=w.assignee_id and cm.active and cp.role in ('admin','facilitator','consultant'))
      or not exists(select 1 from public.profiles where id=m.created_by and role='admin') and w.assignee_id is distinct from m.created_by
      or exists(select 1 from public.leads where id=m.lead_id and opportunity_stage in ('won','lost'))
      or m.proposal_id is not null and not exists(select 1 from public.consultant_proposals where id=m.proposal_id and checklist_revision=w.checklist_revision) then
      update public.consultant_messages set status='cancelled',error='ASSIGNMENT_OR_STATE_CHANGED' where id=m.id;
      continue;
    end if;
    update public.consultant_messages set status='processing',lease_token=p_lease,lease_until=now()+interval '5 minutes'
      where id=m.id returning * into m;
    return to_jsonb(m);
  end loop;
  return null;
end; $$;

create or replace function public.consultant_finish_message(p_id uuid,p_lease uuid,p_status text,p_provider text,p_error text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.consultant_messages;
begin
  if p_status not in ('accepted','failed','uncertain','cancelled') then raise exception 'CONSULTANT_INVALID'; end if;
  update public.consultant_messages set status=p_status,provider_id=p_provider,error=left(p_error,300),processed_at=now(),lease_until=null
    where id=p_id and lease_token=p_lease and status='processing' returning * into m;
  if not found then return false; end if;
  if p_status='accepted' then
    if m.kind='proposal' then
      update public.consultant_proposals set status='sent',sent_at=coalesce(sent_at,now()) where id=m.proposal_id;
      update public.leads set opportunity_stage='proposal',pipeline_updated_at=now() where id=m.lead_id
        and coalesce(opportunity_stage,'identified') in ('identified','qualified','consultation');
    end if;
    perform public.consultant_event(m.created_by,m.lead_id,'consultant_message_accepted','Pesan diterima penyedia email.');
  end if;
  return true;
end; $$;

-- Keep the older sales owner control consistent with the portal's account assignment.
create or replace function public.consultant_sync_owner()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare target uuid; w public.consultant_workspaces;
begin
  if new.opportunity_owner is not distinct from old.opportunity_owner then return new; end if;
  select m.user_id into target from public.consultant_members m join public.profiles p on p.id=m.user_id
    where m.active and m.email=lower(btrim(new.opportunity_owner)) and p.role in ('admin','consultant','facilitator');
  select * into w from public.consultant_workspaces where lead_id=new.id for update;
  if not found then
    if target is null then return new; end if;
    insert into public.consultant_workspaces(lead_id) values(new.id) returning * into w;
  end if;
  if w.assignee_id is not distinct from target then return new; end if;
  if exists(select 1 from public.consultant_messages where lead_id=new.id and status='processing' and lease_until>now())
    then raise exception 'CONSULTANT_SEND_IN_FLIGHT'; end if;
  update public.consultant_workspaces set assignee_id=target,assignment_revision=assignment_revision+1,
    version=version+1,updated_at=now() where lead_id=new.id;
  update public.consultant_messages set status='cancelled',error='ASSIGNMENT_CHANGED' where lead_id=new.id and status='queued';
  new.outreach_paused:=true; new.outreach_pause_reason:='Penugasan konsultasi diperbarui';
  return new;
end; $$;
drop trigger if exists consultant_owner_sync on public.leads;
create trigger consultant_owner_sync before update of opportunity_owner on public.leads
  for each row execute function public.consultant_sync_owner();

create or replace function public.consultant_agenda(p_actor uuid,p_page integer default 0,p_owner text default 'all',p_kind text default 'tasks')
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.consultant_actor(p_actor);
  if p_page not between 0 and 10000 or p_kind not in ('tasks','bookings') then raise exception 'CONSULTANT_INVALID'; end if;
  with items as (
    select t.id,t.lead_id,t.due_at as sort_at,to_jsonb(t)||jsonb_build_object('company',l.company,
      'assigneeName',m.display_name,'assigneeId',w.assignee_id) as value
    from public.consultant_tasks t join public.leads l on l.id=t.lead_id
      left join public.consultant_workspaces w on w.lead_id=t.lead_id left join public.consultant_members m on m.user_id=w.assignee_id
    where p_kind='tasks' and t.status='open'
    union all
    select b.id,b.lead_id,b.start_time,jsonb_build_object('id',b.id,'lead_id',b.lead_id,'title',b.title,
      'start_time',b.start_time,'end_time',b.end_time,'status',b.status,'meeting_url',b.meeting_url,
      'company',l.company,'assigneeName',m.display_name,'assigneeId',w.assignee_id)
    from public.calendar_bookings b join public.leads l on l.id=b.lead_id
      left join public.consultant_workspaces w on w.lead_id=b.lead_id left join public.consultant_members m on m.user_id=w.assignee_id
    where p_kind='bookings' and b.end_time>=now() and b.status in ('confirmed','rescheduled','requested')
  ), filtered as materialized (
    select * from items where p_owner='all' or p_owner='mine' and value->>'assigneeId'=p_actor::text
      or p_owner='unassigned' and value->>'assigneeId' is null or value->>'assigneeId'=p_owner
  ) select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'pageSize',20,
    'records',coalesce((select jsonb_agg(value order by sort_at,id) from (select * from filtered order by sort_at,id limit 20 offset p_page*20) q),'[]'::jsonb)) into result;
  return result;
end; $$;

do $$ declare t text; f record;
begin
  foreach t in array array['consultant_members','consultant_workspaces','consultant_tasks','consultant_proposals','consultant_messages'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('consultant_actor','consultant_lock_work','consultant_event','consultant_lead_record',
      'consultant_portal_read','consultant_portal_detail','consultant_manage','consultant_save_work','consultant_store_proposal',
      'consultant_queue_message','consultant_expire_messages','consultant_claim_message','consultant_finish_message','consultant_agenda','consultant_sync_owner') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end; $$;
commit;
