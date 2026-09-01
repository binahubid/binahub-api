-- Phase 13 UAT repair: keep won-to-client handoff compatible with projects.source_id
-- on both legacy UUID production schemas and text-based fresh installations.

begin;

do $migration$
declare
  target_function regprocedure;
  function_definition text;
  compatible_expression text := '(jsonb_populate_record(NULL::public.projects, jsonb_build_object(''source_id'', source_lead.id::text))).source_id';
begin
  target_function := to_regprocedure('public.convert_won_lead_to_client(uuid,text,text,text,text,date)');
  if target_function is null then
    raise exception 'CLIENT_HANDOFF_FUNCTION_MISSING';
  end if;

  function_definition := pg_get_functiondef(target_function);
  if position('jsonb_populate_record' in function_definition) = 0 then
    if position('source_lead.id::text' in function_definition) = 0 then
      raise exception 'CLIENT_HANDOFF_SOURCE_ASSIGNMENT_NOT_FOUND';
    end if;

    function_definition := replace(
      function_definition,
      'source_lead.id::text',
      compatible_expression
    );
    execute function_definition;
  end if;
end;
$migration$;

comment on function public.convert_won_lead_to_client(uuid,text,text,text,text,date) is
  'Atomically converts a won lead into an idempotent client handoff; source_id is hydrated through the projects row type for UUID/text schema compatibility.';

commit;
