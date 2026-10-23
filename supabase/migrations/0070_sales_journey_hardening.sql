-- Run after SQL 69. No sending, activation, deletion, or private CEO source.
begin;

create or replace function public.advance_sales_stage_from_activity(p_lead_id uuid,p_stage text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_lead public.leads; stages text[]:=array['identified','qualified','consultation','proposal','negotiation']; advanced boolean:=false;
begin
  if p_stage is null or not(p_stage=any(stages[1:4])) then raise exception 'INVALID_ACTIVITY_STAGE'; end if;
  select * into current_lead from public.leads where id=p_lead_id for update;
  if not found then raise exception 'LEAD_NOT_FOUND'; end if;
  if current_lead.lifecycle_stage not in ('client','retained')
    and coalesce(array_position(stages,current_lead.opportunity_stage),999)<=array_position(stages,p_stage) then
    advanced:=current_lead.opportunity_stage<>p_stage;
    update public.leads set opportunity_stage=p_stage,lifecycle_stage='lead',pipeline_updated_at=now()
      where id=p_lead_id returning * into current_lead;
  end if;
  update public.leads set last_meaningful_activity_at=now() where id=p_lead_id;
  return jsonb_build_object('stage',current_lead.opportunity_stage,'advanced',advanced);
end; $$;

-- Filter before limiting: closed/paused/exhausted records cannot hide newer due work.
create or replace function public.sales_due_followups(p_since timestamptz default null,p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare inquiries_json jsonb; assessments_json jsonb;
begin
  if p_limit is null or p_limit not between 1 and 500 then raise exception 'INVALID_LIMIT'; end if;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into inquiries_json from (
    select i.* from public.inquiries i
    where i.created_at>=coalesce(p_since,'-infinity'::timestamptz)
      and not coalesce(i.follow_up_paused,false) and i.reply_sent_at is not null
      and coalesce(i.follow_up_level,0)<3
      and coalesce(i.status,'') not in ('Lanjut Diskusi','Qualified','Client','Selesai','Diarsipkan','Closed','Follow Up 3 Terkirim')
      and i.reply_sent_at<=now()-make_interval(days=>case coalesce(i.follow_up_level,0) when 0 then 2 when 1 then 7 else 14 end)
      and not exists(select 1 from public.leads l where l.id=i.lead_id and (l.outreach_paused or l.opportunity_stage in ('consultation','negotiation','won','lost')))
      and not exists(select 1 from public.email_suppressions s where lower(s.email)=lower(i.email))
      and not exists(select 1 from public.calendar_bookings b where (b.lead_id=i.lead_id or lower(b.attendee_email)=lower(i.email)) and b.status in ('requested','confirmed','rescheduled','completed'))
      and (select count(*) from public.follow_up_events e where (i.lead_id is not null and e.lead_id=i.lead_id) or (i.lead_id is null and e.target_type='inquiry' and e.target_id=i.id))<3
      and not exists(select 1 from public.follow_up_claims c where c.target_type='inquiry' and c.target_id=i.id and c.channel='inquiry' and c.level=coalesce(i.follow_up_level,0)+1)
    order by i.reply_sent_at,i.id limit p_limit
  ) t;
  select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into assessments_json from (
    select a.* from public.assessments a
    where a.created_at>=coalesce(p_since,'-infinity'::timestamptz) and not coalesce(a.follow_up_paused,false)
      and not exists(select 1 from public.leads l where l.id=a.lead_id and (l.outreach_paused or l.opportunity_stage in ('consultation','negotiation','won','lost')))
      and not exists(select 1 from public.email_suppressions s where lower(s.email)=lower(a.form_data->>'email'))
      and not exists(select 1 from public.calendar_bookings b where (b.lead_id=a.lead_id or b.assessment_id=a.id or lower(b.attendee_email)=lower(a.form_data->>'email')) and b.status in ('requested','confirmed','rescheduled','completed'))
      and (select count(*) from public.follow_up_events e where (a.lead_id is not null and e.lead_id=a.lead_id) or (a.lead_id is null and e.target_type='assessment' and e.target_id=a.id))<3
      and (
        (a.result_email_sent_at is not null and coalesce(a.result_follow_up_level,0)<3
          and coalesce(a.assessment_status,'') not in ('Minta Proposal','Proposal Terkirim','Lanjut Diskusi','Closed')
          and coalesce(a.proposal_status,'') not in ('Diminta','Sedang Disusun','Gagal Otomatis','Perlu Rekonsiliasi','Menunggu Approval','Terkirim','Revisi','Lanjut Diskusi','Deal','Lost','Closed')
          and a.result_email_sent_at<=now()-make_interval(days=>case coalesce(a.result_follow_up_level,0) when 0 then 2 when 1 then 7 else 14 end)
          and not exists(select 1 from public.follow_up_claims c where c.target_type='assessment' and c.target_id=a.id and c.channel='result' and c.level=coalesce(a.result_follow_up_level,0)+1))
        or (a.proposal_sent_at<=now()-interval '2 days' and coalesce(a.proposal_follow_up_level,0)=0
          and coalesce(a.proposal_status,'') not in ('Revisi','Lanjut Diskusi','Deal','Lost','Closed')
          and not exists(select 1 from public.follow_up_claims c where c.target_type='assessment' and c.target_id=a.id and c.channel='proposal' and c.level=1))
      ) order by least(a.result_email_sent_at,a.proposal_sent_at),a.id limit p_limit
  ) t;
  return jsonb_build_object('inquiries',inquiries_json,'assessments',assessments_json);
end; $$;

create index if not exists inquiries_followup_due_idx on public.inquiries(reply_sent_at) where follow_up_paused=false;
create index if not exists assessments_result_due_idx on public.assessments(result_email_sent_at) where follow_up_paused=false;
revoke all on function public.advance_sales_stage_from_activity(uuid,text),public.sales_due_followups(timestamptz,int) from public,anon,authenticated;
grant execute on function public.advance_sales_stage_from_activity(uuid,text),public.sales_due_followups(timestamptz,int) to service_role;

-- A crashed worker cannot leave the admin looking at an endless processing state.
-- Delivery may have been accepted before a crash, so do not blindly resend it.
create or replace function public.flag_stalled_standard_proposals(p_limit int default 20)
returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare affected int;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_LIMIT'; end if;
  with stalled as (select id from public.assessments where proposal_status='Sedang Disusun'
    and proposal_sent_at is null and updated_at<now()-interval '10 minutes'
    order by updated_at limit p_limit for update skip locked)
  update public.assessments a set proposal_status='Perlu Rekonsiliasi',proposal_gate_status='pending_approval',
    proposal_gate_reasons=jsonb_build_array(jsonb_build_object('code','STANDARD_PROPOSAL_PROCESSING_INTERRUPTED',
      'message','Pemrosesan terhenti. Periksa status email sebelum melanjutkan pengiriman.','severity','blocking'))
    from stalled s where a.id=s.id;
  get diagnostics affected=row_count;return affected;
end; $$;
revoke all on function public.flag_stalled_standard_proposals(int) from public,anon,authenticated;
grant execute on function public.flag_stalled_standard_proposals(int) to service_role;

alter table public.pe_guest_contacts add column if not exists acquisition_context jsonb not null default '{}';
create or replace function public.pe_record_acquisition_context(p_id uuid,p_hash text,p_context jsonb)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_context is null or jsonb_typeof(p_context)<>'object' or octet_length(p_context::text)>8000 then raise exception 'PE_INVALID_REQUEST'; end if;
  if exists(select 1 from jsonb_each(p_context) where key not in ('utmSource','utmMedium','utmCampaign','utmContent','utmTerm','gclid','fbclid','msclkid','journeyId')
    or jsonb_typeof(value)<>'string' or length(value#>>'{}')>500) then raise exception 'PE_INVALID_REQUEST'; end if;
  update public.pe_guest_contacts set acquisition_context=case when acquisition_context='{}'::jsonb then p_context else acquisition_context end
    where attempt_id=p_id and draft_hash=p_hash;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  return true;
end; $$;

create table if not exists public.pe_consultation_requests (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid unique references public.pe_participant_attempts(id) on delete set null,
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.pe_consultation_requests enable row level security;
revoke all on public.pe_consultation_requests from public,anon,authenticated,service_role;
create or replace function public.pe_request_consultation(p_id uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.pe_participant_attempts; c public.pe_guest_contacts; inquiry_uuid uuid; lead_uuid uuid;
begin
  select * into a from public.pe_participant_attempts where id=p_id and owner_id=p_owner and status='submitted' and retention_until>now() for update;
  if not found then raise exception 'PE_ATTEMPT_NOT_FOUND'; end if;
  if not exists(select 1 from public.pe_review_permissions where attempt_id=p_id and granted_at is not null and revoked_at is null) then raise exception 'PE_CONSENT_REQUIRED'; end if;
  select inquiry_id into inquiry_uuid from public.pe_consultation_requests where attempt_id=p_id;
  if inquiry_uuid is not null then return jsonb_build_object('inquiryId',inquiry_uuid,'status','requested'); end if;
  select * into strict c from public.pe_guest_contacts where attempt_id=p_id;
  insert into public.leads(name,email,company,phone,source,lifecycle_stage,opportunity_stage,source_metadata)
    values(c.name,c.email,null,'','individual_consultation','lead','identified',c.acquisition_context)
    on conflict(email) do nothing;
  select id into strict lead_uuid from public.leads where email=c.email;
  insert into public.inquiries(lead_id,name,email,message,source,status,module_request_data)
    values(lead_uuid,c.name,c.email,'Permintaan konsultasi pengembangan individu. Peran: '||(a.context->>'role')||'. Tujuan: '||(a.context->>'goal'),
      'individual_consultation','Baru',jsonb_build_object('individualAttemptId',p_id)) returning id into inquiry_uuid;
  insert into public.pe_consultation_requests(attempt_id,inquiry_id) values(p_id,inquiry_uuid);
  return jsonb_build_object('inquiryId',inquiry_uuid,'status','requested');
end; $$;
revoke all on function public.pe_record_acquisition_context(uuid,text,jsonb),public.pe_request_consultation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pe_record_acquisition_context(uuid,text,jsonb),public.pe_request_consultation(uuid,uuid) to service_role;
commit;
