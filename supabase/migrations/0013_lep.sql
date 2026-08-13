-- Prompt 8: LEP (Lembar Evaluasi Program) module.
-- Scoped per program/engagement (WS8). Speakers are dynamic per program (like flexible batches).

begin;

-- 1. Speakers (per program)
create table if not exists public.lep_speakers (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.engagements(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.lep_speakers is 'LEP speaker per program. Count is flexible per program.';
create index if not exists lep_speakers_program_idx on public.lep_speakers (program_id);

-- 2. Responses (one per participant per program)
create table if not exists public.lep_responses (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.engagements(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  q_menyenangkan int not null check (q_menyenangkan between 1 and 4),
  q_bermanfaat int not null check (q_bermanfaat between 1 and 4),
  q_rekomendasi int not null check (q_rekomendasi between 1 and 4),
  q_praktik int not null check (q_praktik between 1 and 4),
  hal_terpenting text not null,
  hal_menarik text not null,
  saran_program text,
  submitted_at timestamptz not null default now()
);

comment on table public.lep_responses is 'LEP survey responses. One response per participant per program (scale 1-4).';
create index if not exists lep_responses_program_idx on public.lep_responses (program_id);

-- Unique: one participant submits once per program.
alter table public.lep_responses
  add constraint lep_responses_program_profile_unique unique (program_id, profile_id);

-- 3. Speaker ratings (linked to a response)
create table if not exists public.lep_speaker_ratings (
  response_id uuid not null references public.lep_responses(id) on delete cascade,
  speaker_id uuid not null references public.lep_speakers(id) on delete cascade,
  score int not null check (score between 1 and 4),
  comment text,
  primary key (response_id, speaker_id)
);

comment on table public.lep_speaker_ratings is 'Per-speaker rating within a LEP response.';
create index if not exists lep_speaker_ratings_speaker_idx on public.lep_speaker_ratings (speaker_id);

commit;