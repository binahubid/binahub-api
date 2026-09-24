-- Persist AI-assisted inquiry replies and require a separate human review before delivery.

begin;

alter table public.inquiries
  add column if not exists reply_subject text,
  add column if not exists reply_body text,
  add column if not exists reply_status text not null default 'none',
  add column if not exists reply_generated_at timestamptz,
  add column if not exists reply_generated_by text,
  add column if not exists reply_reviewed_at timestamptz,
  add column if not exists reply_reviewed_by text,
  add column if not exists reply_sent_at timestamptz,
  add column if not exists reply_email_id text;

alter table public.inquiries
  drop constraint if exists inquiries_reply_status_check;

alter table public.inquiries
  add constraint inquiries_reply_status_check
  check (reply_status in ('none', 'draft', 'reviewed', 'sending', 'sent'));

create index if not exists inquiries_reply_status_idx
  on public.inquiries (reply_status, created_at desc);

-- Preliminary Recommendation receives one follow-up only. Historical rows remain
-- auditable but are no longer approved for future delivery.
update public.outreach_templates
set status = 'archived', updated_at = now()
where template_key in ('assessment_proposal_follow_up_2', 'assessment_proposal_follow_up_3')
  and status = 'approved';

commit;
