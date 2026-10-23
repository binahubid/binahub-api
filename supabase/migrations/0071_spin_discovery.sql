-- SQL 71: SPIN organization discovery. Run after SQL 70 in the API database.
-- Additive only. Does not modify assessments, existing sending controls, or real programs.
-- No automatic deletion of SPIN business data. Link/session expiration is access control.
begin;
create table if not exists public.spin_submissions (
 id uuid primary key, draft_hash text not null check(draft_hash ~ '^[a-f0-9]{64}$'),
 draft_until timestamptz not null default now()+interval '30 days',
 question_version text not null, notice_version text not null, consented_at timestamptz not null default now(),
 answers jsonb not null default '{}', confirmation jsonb, summary jsonb,
 revision int not null default 0, status text not null default 'draft' check(status in ('draft','queued','processing','ready','failed')),
 contact jsonb, marketing_consent boolean not null default false, submitted_at timestamptz, submit_key text,
 report jsonb, internal_report jsonb, lease uuid, lease_until timestamptz, attempts int not null default 0,
 next_attempt_at timestamptz not null default now(), error_code text,
 lead_id uuid references public.leads(id) on delete set null,
 inquiry_id uuid references public.inquiries(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(jsonb_typeof(answers)='object'), check(status='draft' or (submitted_at is not null and contact is not null and summary is not null and confirmation is not null)),
 check(revision>=0 and attempts>=0)
);
create index if not exists spin_work_due on public.spin_submissions(status,next_attempt_at);
create table if not exists public.spin_mail_jobs(
 id uuid primary key default gen_random_uuid(), submission_id uuid not null references public.spin_submissions(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','sending','sent','uncertain','failed')),
 recipient text not null, from_address text, app_origin text,
 lease uuid, lease_until timestamptz, attempts int not null default 0,
 first_attempt_at timestamptz, next_attempt_at timestamptz not null default now(),
 link_hash text, link_until timestamptz, link_used_at timestamptz,
 provider_id text, sent_at timestamptz, pdf_base64 text, created_at timestamptz not null default now()
);
create index if not exists spin_mail_due on public.spin_mail_jobs(status,next_attempt_at);
create table if not exists public.spin_result_sessions(
 hash text primary key check(hash ~ '^[a-f0-9]{64}$'), submission_id uuid not null references public.spin_submissions(id) on delete cascade,
 expires_at timestamptz not null default now()+interval '30 minutes'
);
create table if not exists public.spin_events (
 id bigint generated always as identity primary key, submission_id uuid references public.spin_submissions(id) on delete set null,
 event text not null, created_at timestamptz not null default now()
);
create or replace function public.spin_draft_dto(a public.spin_submissions) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',a.id,'answers',a.answers,'confirmation',a.confirmation,'revision',a.revision,
 'status',a.status,'createdAt',a.created_at,'updatedAt',a.updated_at,'submittedAt',a.submitted_at);
$$;
create or replace function public.spin_start(p_id uuid,p_hash text,p_version text,p_notice text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 if p_id is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
 or p_version is distinct from 'spin-v3.2-ceo-2026-10-22' or p_notice is distinct from 'spin-processing-indefinite-v1' then raise exception 'SPIN_INVALID_REQUEST';end if;
 insert into public.spin_submissions(id,draft_hash,question_version,notice_version)values(p_id,p_hash,p_version,p_notice)on conflict(id)do nothing;
 select * into a from public.spin_submissions where id=p_id and draft_hash=p_hash and draft_until>now();
 if not found then raise exception 'SPIN_NOT_FOUND';end if;
 return public.spin_draft_dto(a);
end;$$;
create or replace function public.spin_read_draft(p_id uuid,p_hash text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 select * into a from public.spin_submissions where id=p_id and draft_hash=p_hash and draft_until>now();
 if not found then raise exception 'SPIN_NOT_FOUND';end if;
 return public.spin_draft_dto(a);
end;$$;
create or replace function public.spin_write(p_id uuid,p_hash text,p_revision int,p_answers jsonb,p_confirmation jsonb,p_summary jsonb,p_submit jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions; lid uuid; iid uuid; email_value text;
begin
 select * into a from public.spin_submissions where id=p_id and draft_hash=p_hash and draft_until>now() for update;
 if not found then raise exception 'SPIN_NOT_FOUND';end if;
 if a.status<>'draft' then
  if p_submit is not null and a.submit_key=p_submit->>'idempotencyKey' and a.answers=p_answers and a.contact=p_submit->'contact' and a.confirmation=p_confirmation then return public.spin_draft_dto(a);end if;
  raise exception 'SPIN_FINALIZED';
 end if;
 if p_revision is null or a.revision<>p_revision then raise exception 'SPIN_REVISION_CONFLICT';end if;
 if p_answers is null or jsonb_typeof(p_answers)<>'object' or octet_length(p_answers::text)>20000 then raise exception 'SPIN_INVALID_REQUEST';end if;
 if p_submit is not null then
  if p_confirmation is null or p_summary is null or p_submit->>'processingConsent' is distinct from 'true'
   or p_submit->>'noticeVersion'<>'spin-processing-indefinite-v1' or p_submit->>'idempotencyKey' !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_submit->'contact') is distinct from 'object' or nullif(p_submit->'contact'->>'email','') is null then raise exception 'SPIN_CONFIRMATION_REQUIRED';end if;
  email_value:=lower(p_submit->'contact'->>'email');
  insert into public.leads(name,email,company,phone,source,lifecycle_stage,opportunity_stage,source_metadata)
   values(p_submit->'contact'->>'name',email_value,p_submit->'contact'->>'company',p_submit->'contact'->>'phone','spin_discovery','lead','identified',jsonb_build_object('spinSubmissionId',p_id))
   on conflict(email)do nothing;
  select id into strict lid from public.leads where email=email_value;
  insert into public.inquiries(lead_id,name,email,whatsapp,message,source,status,module_request_data,follow_up_paused)
   values(lid,p_submit->'contact'->>'name',email_value,p_submit->'contact'->>'phone','Permintaan rekomendasi kebutuhan organisasi. Lihat workspace Discovery untuk ringkasan dan laporan.',
    'spin_discovery','Baru',jsonb_build_object('spinSubmissionId',p_id),true) returning id into iid;
 end if;
 update public.spin_submissions set answers=p_answers,confirmation=p_confirmation,summary=p_summary,
  revision=revision+1,updated_at=now(),status=case when p_submit is null then 'draft' else 'queued' end,
  contact=case when p_submit is null then null else p_submit->'contact' end,
  marketing_consent=coalesce((p_submit->>'marketingConsent')::boolean,false),submitted_at=case when p_submit is not null then now() end,
  submit_key=p_submit->>'idempotencyKey',lead_id=lid,inquiry_id=iid where id=p_id returning * into a;
 if p_submit is not null then insert into public.spin_events(submission_id,event)values(p_id,'submitted');end if;
 return public.spin_draft_dto(a);
end;$$;
create or replace function public.spin_claim(p_id uuid default null)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 select * into a from public.spin_submissions where (p_id is null or id=p_id) and
 (status in('queued','failed') or status='processing' and lease_until<now()) and attempts<3 and next_attempt_at<=now()
 order by submitted_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.spin_submissions set status='processing',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1
 where id=a.id returning * into a;
 return to_jsonb(a);
end;$$;
create or replace function public.spin_finish(p_id uuid,p_lease uuid,p_report jsonb,p_internal jsonb,p_error text default null)returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 select * into a from public.spin_submissions where id=p_id and lease=p_lease and status='processing' for update;
 if not found then return false;end if;
 if p_error is not null then
  update public.spin_submissions set status='failed',error_code='SPIN_PROCESSING_RETRY',next_attempt_at=now()+interval '5 minutes',lease=null,lease_until=null where id=p_id;
 else
  if p_report is null or p_internal is null then raise exception 'SPIN_INVALID_REQUEST';end if;
  update public.spin_submissions set status='ready',report=p_report,internal_report=p_internal,lease=null,lease_until=null,error_code=null where id=p_id;
  insert into public.spin_mail_jobs(submission_id,recipient)values(p_id,a.contact->>'email');
  insert into public.spin_events(submission_id,event)values(p_id,'report_ready');
 end if;return true;
end;$$;
create or replace function public.spin_claim_mail(p_id uuid default null,p_from text default null,p_origin text default null)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.spin_mail_jobs; a public.spin_submissions;
begin
 update public.spin_mail_jobs set status='uncertain' where first_attempt_at<now()-interval '23 hours' and status in('pending','sending');
 select * into j from public.spin_mail_jobs where (p_id is null or submission_id=p_id) and
 (status='pending' or status='sending' and lease_until<now()) and attempts<5 and next_attempt_at<=now()
 order by created_at limit 1 for update skip locked;
 if not found then return null;end if;
 if p_from is null or p_origin is null then raise exception 'SPIN_SETUP_REQUIRED';end if;
 select * into strict a from public.spin_submissions where id=j.submission_id and report is not null;
 update public.spin_mail_jobs set status='sending',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',attempts=attempts+1,
 first_attempt_at=coalesce(first_attempt_at,now()),from_address=coalesce(from_address,p_from),app_origin=coalesce(app_origin,p_origin),
 link_until=coalesce(link_until,now()+interval '48 hours') where id=j.id returning * into j;
 return to_jsonb(j)||jsonb_build_object('report',a.report,'name',a.contact->>'name');
end;$$;
create or replace function public.spin_prepare_mail(p_id uuid,p_lease uuid,p_hash text,p_pdf text)returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare frozen_pdf text;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_pdf is null or length(p_pdf)>4000000 then raise exception 'SPIN_INVALID_REQUEST';end if;
 update public.spin_mail_jobs set link_hash=coalesce(link_hash,p_hash),pdf_base64=coalesce(pdf_base64,p_pdf)
 where id=p_id and lease=p_lease and status='sending' and (link_hash is null or link_hash=p_hash) returning pdf_base64 into frozen_pdf;
 if not found then raise exception 'SPIN_NOT_FOUND';end if;
 return frozen_pdf;
end;$$;
create or replace function public.spin_finish_mail(p_id uuid,p_lease uuid,p_provider text default null)returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.spin_mail_jobs; a public.spin_submissions;
begin
 select * into j from public.spin_mail_jobs where id=p_id and lease=p_lease and status='sending' for update;
 if not found then return false;end if;
 update public.spin_mail_jobs set status=case when p_provider is not null then 'sent' else 'pending' end,
 provider_id=p_provider,sent_at=case when p_provider is not null then now() end,lease=null,lease_until=null,next_attempt_at=now()+interval '5 minutes' where id=p_id;
 if p_provider is not null then
  insert into public.spin_events(submission_id,event)values(j.submission_id,'email_sent');
  select * into strict a from public.spin_submissions where id=j.submission_id;
  -- Use existing inquiry follow-up only after actual delivery. Never reset an older sequence.
  perform 1 from public.leads where id=a.lead_id for update;
  update public.inquiries i set reply_status='sent',reply_email_id=p_provider,reply_sent_at=now(),
   message='Permintaan rekomendasi kebutuhan organisasi. Kebutuhan: '||left(a.summary->>'problem',700)||'. Hasil yang diharapkan: '||left(a.summary->>'outcome',700),
   follow_up_paused=exists(select 1 from public.inquiries other where other.lead_id=a.lead_id and other.id<>i.id
     and other.reply_sent_at is not null and not other.follow_up_paused and other.status not in('Closed','Client','Selesai','Diarsipkan','Lanjut Diskusi'))
    or exists(select 1 from public.assessments assessed where assessed.lead_id=a.lead_id and not assessed.follow_up_paused
     and assessed.result_email_sent_at is not null and assessed.assessment_status not in('Closed','Client','Selesai','Lanjut Diskusi'))
  where i.id=a.inquiry_id and i.reply_sent_at is null;
  if a.answers->>'nextStep' in('proposal_email','both') and to_regprocedure('public.advance_sales_stage_from_activity(uuid,text)') is not null then
   perform public.advance_sales_stage_from_activity(a.lead_id,'proposal');
  end if;
 end if;
 return true;
end;$$;
create or replace function public.spin_open_result(p_id uuid,p_link uuid,p_hash text,p_session text)returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if p_session is null or p_session !~ '^[a-f0-9]{64}$' then raise exception 'SPIN_INVALID_REQUEST';end if;
 update public.spin_mail_jobs set link_used_at=now() where id=p_link and submission_id=p_id and link_hash=p_hash and link_until>now() and link_used_at is null;
 if not found then raise exception 'SPIN_LINK_EXPIRED';end if;
 insert into public.spin_result_sessions(hash,submission_id)values(p_session,p_id);
 return true;
end;$$;
create or replace function public.spin_read_result(p_id uuid,p_session text)returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r jsonb;
begin
 select a.report into r from public.spin_submissions a join public.spin_result_sessions s on s.submission_id=a.id
 where a.id=p_id and s.hash=p_session and s.expires_at>now();
 if r is null then raise exception 'SPIN_NOT_FOUND';end if;return r;
end;$$;
create or replace function public.spin_request_link(p_id uuid,p_email text)returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.spin_submissions;
begin
 select * into a from public.spin_submissions where id=p_id and status='ready' and lower(contact->>'email')=lower(p_email) for update;
 if not found then return;end if;
 if exists(select 1 from public.spin_mail_jobs where submission_id=p_id and created_at>now()-interval '10 minutes')then return;end if;
 insert into public.spin_mail_jobs(submission_id,recipient)values(p_id,a.contact->>'email');
end;$$;
alter table public.spin_submissions enable row level security;
alter table public.spin_mail_jobs enable row level security;
alter table public.spin_result_sessions enable row level security;
alter table public.spin_events enable row level security;
revoke all on public.spin_submissions,public.spin_mail_jobs,public.spin_result_sessions,public.spin_events from public,anon,authenticated,service_role;
grant select on public.spin_submissions,public.spin_mail_jobs,public.spin_events to service_role;
do $$ declare r record;begin
 for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in('spin_draft_dto','spin_start','spin_read_draft','spin_write','spin_claim','spin_finish','spin_claim_mail','spin_prepare_mail','spin_finish_mail','spin_open_result','spin_read_result','spin_request_link')
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
 if r.signature::text not like 'spin_draft_dto(%' then execute format('grant execute on function %s to service_role',r.signature);end if;
 end loop;
end;$$;
commit;
