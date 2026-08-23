-- Add BinaInsight as a program module, link participant assessments to programs,
-- and reserve each follow-up delivery before an external email is sent.

begin;

alter table public.program_modules
  drop constraint if exists program_modules_module_key_check;
alter table public.program_modules
  add constraint program_modules_module_key_check
  check (module_key in ('tbos', 'lep', 'binainsight'));

alter table public.assessments
  add column if not exists program_id uuid references public.engagements(id) on delete set null,
  add column if not exists participant_id uuid references public.participants(id) on delete set null;

create index if not exists assessments_program_participant_idx
  on public.assessments (program_id, participant_id, created_at desc)
  where program_id is not null and participant_id is not null;

create table if not exists public.follow_up_claims (
  target_type text not null check (target_type in ('inquiry', 'assessment')),
  target_id uuid not null,
  channel text not null check (channel in ('inquiry', 'result', 'proposal')),
  level integer not null check (level between 1 and 3),
  status text not null default 'processing' check (status in ('processing', 'sent', 'delivery_unconfirmed')),
  actor text not null,
  email_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_type, target_id, channel, level)
);

alter table public.follow_up_claims enable row level security;
revoke all on table public.follow_up_claims from anon, authenticated;

commit;
