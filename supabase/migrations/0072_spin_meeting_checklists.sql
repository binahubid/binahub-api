-- SQL 72: internal meeting checklists. Run after SQL 71.
-- Additive: never changes client answers, reports, mail jobs, or real programs.
begin;
do $$ begin
 if to_regclass('public.spin_submissions') is null then raise exception 'SPIN_SQL71_REQUIRED'; end if;
end; $$;

create table if not exists public.spin_meeting_checklists (
 id uuid primary key,
 source_id uuid unique references public.spin_submissions(id) on delete cascade,
 contact jsonb not null check(jsonb_typeof(contact)='object'),
 question_version text not null check(question_version='spin-v3.2-ceo-2026-10-22'),
 notice_version text not null default 'spin-processing-indefinite-v1' check(notice_version='spin-processing-indefinite-v1'),
 answers jsonb not null default '{}' check(jsonb_typeof(answers)='object' and octet_length(answers::text)<=20000),
 notes text not null default '' check(length(notes)<=4000),
 status text not null default 'in_progress' check(status in ('in_progress','completed')),
 revision int not null check(revision>=1),
 created_by uuid not null, updated_by uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(source_id is null or source_id=id)
);
create table if not exists public.spin_meeting_events (
 id bigint generated always as identity primary key,
 checklist_id uuid not null references public.spin_meeting_checklists(id) on delete cascade,
 revision int not null, actor_id uuid not null, action text not null check(action in ('saved','completed')),
 created_at timestamptz not null default now(), unique(checklist_id,revision)
);

create or replace function public.spin_save_meeting(
 p_id uuid,p_actor uuid,p_revision int,p_source_id uuid,p_contact jsonb,p_answers jsonb,p_notes text,p_status text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_meeting_checklists; s public.spin_submissions; exists_before boolean;
begin
 if p_id is null or p_actor is null or p_revision is null or p_revision<0
  or p_status is null or p_status not in ('in_progress','completed')
  or p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>20000
  or p_notes is null or length(p_notes)>4000
  or p_contact is null or jsonb_typeof(p_contact)<>'object'
  or nullif(btrim(p_contact->>'name'),'') is null or nullif(btrim(p_contact->>'company'),'') is null
  or nullif(btrim(p_contact->>'email'),'') is null then raise exception 'SPIN_INVALID_REQUEST'; end if;
 -- Serialize even the first save. A retry cannot create a second checklist.
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,72));
 select * into a from public.spin_meeting_checklists where id=p_id for update;
 exists_before:=found;
 if exists_before then
  if a.source_id is distinct from p_source_id or a.contact<>p_contact then raise exception 'SPIN_INVALID_REQUEST'; end if;
  if a.revision=p_revision+1 and a.answers=p_answers and a.notes=p_notes and a.status=p_status and a.updated_by=p_actor then
   return to_jsonb(a);
  end if;
  if a.revision<>p_revision then raise exception 'SPIN_REVISION_CONFLICT'; end if;
 elsif p_revision<>0 then raise exception 'SPIN_REVISION_CONFLICT'; end if;
 if p_source_id is null and exists(select 1 from public.spin_submissions where id=p_id) then raise exception 'SPIN_INVALID_REQUEST'; end if;
 if p_source_id is not null then
  if p_source_id<>p_id then raise exception 'SPIN_INVALID_REQUEST'; end if;
  select * into s from public.spin_submissions where id=p_source_id and submitted_at is not null for share;
  if not found then raise exception 'SPIN_NOT_FOUND'; end if;
  if s.question_version<>'spin-v3.2-ceo-2026-10-22' or s.contact<>p_contact then raise exception 'SPIN_INVALID_REQUEST'; end if;
 end if;
 if exists_before then
  update public.spin_meeting_checklists set answers=p_answers,notes=p_notes,status=p_status,
   revision=revision+1,updated_by=p_actor,updated_at=now() where id=p_id returning * into a;
 else
  insert into public.spin_meeting_checklists(id,source_id,contact,question_version,answers,notes,status,revision,created_by,updated_by)
   values(p_id,p_source_id,p_contact,'spin-v3.2-ceo-2026-10-22',p_answers,p_notes,p_status,1,p_actor,p_actor) returning * into a;
 end if;
 insert into public.spin_meeting_events(checklist_id,revision,actor_id,action)
  values(p_id,a.revision,p_actor,case when p_status='completed' then 'completed' else 'saved' end);
 return to_jsonb(a);
end; $$;

-- One inbox entry per client submission; standalone admin checklists also appear.
create or replace function public.spin_meeting_inbox(p_page int default 0,p_search text default '') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
 if p_page is null or p_page not between 0 and 10000 or p_search is null or length(p_search)>150 then raise exception 'SPIN_INVALID_REQUEST'; end if;
 with entries as (
  select s.id,s.contact,s.status,s.submitted_at,coalesce(m.updated_at,s.submitted_at) as activity_at,
   true as has_source,m.status as meeting_status,m.revision as meeting_revision
  from public.spin_submissions s left join public.spin_meeting_checklists m on m.source_id=s.id where s.submitted_at is not null
  union all
  select m.id,m.contact,'meeting',m.created_at,m.updated_at,false,m.status,m.revision
  from public.spin_meeting_checklists m where m.source_id is null
 ), filtered as (
  select * from entries where p_search='' or strpos(lower((contact->>'name')||' '||(contact->>'company')||' '||(contact->>'email')),lower(p_search))>0
 ), page_rows as (
  select * from filtered order by activity_at desc,id limit 20 offset p_page*20
 ) select jsonb_build_object('records',coalesce((select jsonb_agg(to_jsonb(r) order by r.activity_at desc,r.id) from page_rows r),'[]'::jsonb),
  'total',(select count(*) from filtered),'page',p_page) into result;
 return result;
end; $$;

alter table public.spin_meeting_checklists enable row level security;
alter table public.spin_meeting_events enable row level security;
revoke all on public.spin_meeting_checklists,public.spin_meeting_events from public,anon,authenticated,service_role;
grant select on public.spin_meeting_checklists,public.spin_meeting_events to service_role;
revoke all on function public.spin_save_meeting(uuid,uuid,int,uuid,jsonb,jsonb,text,text),public.spin_meeting_inbox(int,text) from public,anon,authenticated,service_role;
grant execute on function public.spin_save_meeting(uuid,uuid,int,uuid,jsonb,jsonb,text,text),public.spin_meeting_inbox(int,text) to service_role;
commit;
