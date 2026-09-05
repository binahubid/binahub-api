-- Phase 16 finishing: separate configurable BinaInsight forms per program and
-- permit an unpublished questionnaire draft to intentionally contain no questions.

begin;

alter table public.program_questionnaires
  drop constraint if exists program_questionnaire_kind_valid;
alter table public.program_questionnaires
  add constraint program_questionnaire_kind_valid
  check (kind in ('pre_test', 'post_test', 'binainsight'));

create or replace function public.replace_program_questionnaire_questions(
  p_questionnaire_id uuid,
  p_questions jsonb,
  p_source_filename text default null,
  p_source_type text default null,
  p_actor text default null
)
returns setof public.program_questionnaire_questions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.program_questionnaires where id = p_questionnaire_id) then
    raise exception 'QUESTIONNAIRE_NOT_FOUND';
  end if;
  if jsonb_typeof(p_questions) <> 'array' then
    raise exception 'QUESTION_LIST_INVALID';
  end if;
  if exists (
    select 1 from public.program_questionnaire_submissions where questionnaire_id = p_questionnaire_id
  ) then
    raise exception 'QUESTIONNAIRE_HAS_SUBMISSIONS';
  end if;

  delete from public.program_questionnaire_questions where questionnaire_id = p_questionnaire_id;

  insert into public.program_questionnaire_questions (
    questionnaire_id, position, question_type, prompt, help_text, required,
    options, correct_answer, points, scale_min, scale_max, scale_labels,
    created_by, updated_by
  )
  select
    p_questionnaire_id,
    (item->>'position')::integer,
    item->>'questionType',
    item->>'prompt',
    nullif(item->>'helpText', ''),
    coalesce((item->>'required')::boolean, true),
    coalesce(item->'options', '[]'::jsonb),
    case when item->'correctAnswer' is null or jsonb_typeof(item->'correctAnswer') = 'null'
      then null else item->'correctAnswer' end,
    coalesce((item->>'points')::numeric, 1),
    nullif(item->>'scaleMin', '')::integer,
    nullif(item->>'scaleMax', '')::integer,
    coalesce(item->'scaleLabels', '{}'::jsonb),
    p_actor,
    p_actor
  from jsonb_array_elements(p_questions) item;

  update public.program_questionnaires
  set status = 'draft', published_at = null, source_filename = p_source_filename,
      source_type = p_source_type, version = version + 1, updated_by = p_actor
  where id = p_questionnaire_id;

  return query
  select * from public.program_questionnaire_questions
  where questionnaire_id = p_questionnaire_id order by position;
end;
$$;

revoke all on function public.replace_program_questionnaire_questions(uuid, jsonb, text, text, text)
from public, anon, authenticated;
grant execute on function public.replace_program_questionnaire_questions(uuid, jsonb, text, text, text)
to service_role;

commit;
