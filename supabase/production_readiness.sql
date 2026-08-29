-- Read-only readiness check. Run after all production migrations.

select
  to_regclass('public.program_modules') is not null as program_modules_ready,
  to_regclass('public.batches') is not null as batches_ready,
  to_regclass('public.facilitator_missions') is not null as facilitator_missions_ready,
  to_regclass('public.facilitator_program_assignments') is not null as facilitator_program_assignments_ready,
  to_regclass('public.lep_responses') is not null as lep_ready,
  to_regclass('public.tbos_observation_members') is not null as observation_snapshots_ready,
  to_regclass('public.api_rate_limits') is not null as persistent_rate_limit_ready,
  to_regclass('public.chat_sessions') is not null as chat_sessions_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_client_access_codes'
      and column_name = 'auth_user_id'
  ) as client_auth_binding_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_client_access_codes'
      and column_name = 'program_id'
  ) as client_program_binding_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_client_access_codes'
      and column_name = 'credential_version'
  ) as participant_reentry_code_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'engagements'
      and column_name = 'participant_limit'
  ) as participant_limit_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_sessions'
      and column_name = 'expires_at'
  ) as chat_expiry_ready,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assessments'
      and column_name = 'submission_key_hash'
  )
  and to_regclass('public.assessments_submission_key_unique_idx') is not null
    as assessment_idempotency_ready,
  (
    to_regclass('public.follow_up_claims') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'assessments'
        and column_name = 'program_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'assessments'
        and column_name = 'participant_id'
    )
    and exists (
      select 1
      from pg_constraint constraint_record
      join pg_class table_record on table_record.oid = constraint_record.conrelid
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'public'
        and table_record.relname = 'program_modules'
        and constraint_record.contype = 'c'
        and pg_get_constraintdef(constraint_record.oid) like '%binainsight%'
    )
  ) as binainsight_program_module_ready,
  (
    to_regclass('public.email_suppressions') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'lifecycle_stage'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_temperature'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'opportunity_stage'
    )
  ) as business_funnel_ready,
  (
    to_regprocedure('public.claim_transformation_events(integer,text,integer)') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'event_queue' and column_name = 'locked_at'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'event_queue' and column_name = 'locked_by'
    )
  ) as atomic_event_worker_ready,
  (
    to_regclass('public.business_rule_sets') is not null
    and to_regclass('public.catalog_products') is not null
    and to_regclass('public.catalog_modules') is not null
    and to_regclass('public.proposal_approvals') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'assessments' and column_name = 'proposal_gate_status'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'assessments' and column_name = 'proposal_draft_data'
    )
  ) as proposal_governance_ready,
  (
    to_regclass('public.calendar_bookings') is not null
    and to_regclass('public.calendar_webhook_events') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inquiries' and column_name = 'module_request_data'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'inquiries' and column_name = 'role_title'
    )
  ) as calendar_and_catalog_request_ready,
  (
    exists (
      select 1 from public.business_rule_sets
      where version = 'v1.0-approved-partial'
        and status = 'draft'
        and is_mock = false
        and jsonb_array_length(coalesce(rules #> '{activation,blockers}', '[]'::jsonb)) > 0
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'lead_score_evidence'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'follow_up_events' and column_name = 'lead_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'follow_up_claims' and column_name = 'lead_id'
    )
    and to_regprocedure('public.claim_follow_up_delivery(text,uuid,text,integer,text,uuid)') is not null
  ) as business_rules_v1_guardrails_ready,
  (
    to_regclass('public.opportunity_activities') is not null
    and to_regclass('public.outreach_templates') is not null
    and to_regclass('public.email_delivery_events') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'opportunity_owner'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'next_action_due_at'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'outreach_paused'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'industry'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leads' and column_name = 'qualification_profile'
    )
    and to_regprocedure('public.update_sales_opportunity(uuid,text,text,text,text,timestamptz,text,text,numeric,text,boolean,text)') is not null
    and to_regprocedure('public.save_outreach_template(uuid,text,text,text,text,text,text,text,boolean,text,text)') is not null
  ) as sales_operations_phase2_ready,
  (
    to_regclass('public.email_delivery_events') is not null
    and to_regclass('public.email_suppressions') is not null
    and exists (
      select 1 from pg_constraint constraint_record
      join pg_class table_record on table_record.oid = constraint_record.conrelid
      join pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'public'
        and table_record.relname = 'email_delivery_events'
        and constraint_record.conname = 'email_delivery_events_webhook_unique'
    )
  ) as email_deliverability_ready,
  to_regprocedure('public.create_program_batch(uuid,text)') is not null as batch_rpc_ready,
  to_regprocedure('public.replace_facilitator_missions(uuid,uuid,uuid[])') is not null as assignment_rpc_ready,
  to_regprocedure('public.assign_facilitator_program(uuid,uuid,uuid)') is not null as program_assignment_rpc_ready,
  to_regprocedure('public.select_facilitator_program_mission(uuid,uuid,uuid)') is not null as mission_selection_rpc_ready,
  to_regclass('public.tbos_observations_program_team_mission_unique') is not null as unique_team_mission_observation_ready,
  to_regprocedure('public.tbos_submit_observation_v2(uuid,uuid,uuid,uuid,text,uuid,text,text,jsonb,jsonb,boolean)') is not null as observation_rpc_ready,
  to_regprocedure('public.submit_lep_response(uuid,uuid,integer,integer,integer,integer,text,text,text,jsonb)') is not null as lep_rpc_ready,
  to_regprocedure('public.consume_api_rate_limit(text,integer,integer)') is not null as rate_limit_rpc_ready,
  to_regprocedure('public.register_program_participant(uuid,text,text,text,timestamptz,text,text,boolean,text)') is not null as participant_registration_rpc_ready;

select count(*) as blank_profile_name_issues
from public.profiles
where full_name is null or btrim(full_name) = '';

select count(*) as duplicate_batch_name_issues
from (
  select program_id, lower(btrim(name))
  from public.batches
  group by program_id, lower(btrim(name))
  having count(*) > 1
) duplicates;

select count(*) as duplicate_active_speaker_issues
from (
  select program_id, lower(btrim(name))
  from public.lep_speakers
  where deleted_at is null
  group by program_id, lower(btrim(name))
  having count(*) > 1
) duplicates;

select count(*) as unscoped_observation_issues
from public.tbos_observations
where program_id is null;

select count(*) as invalid_engagement_date_issues
from public.engagements
where end_date < start_date;

select count(*) as missing_program_code_issues
from public.engagements
where code is null or btrim(code) = '';

select count(*) as duplicate_participant_team_per_program_issues
from (
  select team.engagement_id, member.profile_id
  from public.tbos_team_members member
  join public.tbos_teams team on team.id = member.team_id
  where team.engagement_id is not null
    and member.profile_id is not null
  group by team.engagement_id, member.profile_id
  having count(distinct member.team_id) > 1
) duplicates;

select count(*) as team_batch_program_mismatch_issues
from public.tbos_teams team
join public.batches batch on batch.id = team.batch_id
where team.engagement_id is distinct from batch.program_id;

select count(*) as assignment_program_module_issues
from public.facilitator_missions assignment
left join public.program_modules module
  on module.program_id = assignment.program_id
  and module.module_key = 'tbos'
  and module.enabled
where module.program_id is null;

select count(*) as facilitator_position_mirror_issues
from public.facilitator_program_assignments assignment
full join public.facilitator_missions legacy
  on legacy.profile_id = assignment.profile_id
  and legacy.program_id = assignment.program_id
  and legacy.mission_id = assignment.selected_mission_id
where (assignment.selected_mission_id is not null and legacy.profile_id is null)
  or (legacy.profile_id is not null and assignment.profile_id is null);

select count(*) as invalid_master_roster_captain_issues
from (
  select team.id
  from public.tbos_teams team
  join public.tbos_team_members member on member.team_id = team.id
  group by team.id
  having count(*) filter (where member.is_captain) <> 1
) invalid_roster;

select count(*) as duplicate_facilitator_position_issues
from (
  select program_id, selected_mission_id
  from public.facilitator_program_assignments
  where selected_mission_id is not null
  group by program_id, selected_mission_id
  having count(*) > 1
) duplicate_position;

select count(*) as duplicate_team_mission_observation_issues
from (
  select program_id, team_id, mission_id
  from public.tbos_observations
  group by program_id, team_id, mission_id
  having count(*) > 1
) duplicate_observation;

select count(*) as incomplete_tbos_rubric_issues
from public.tbos_behavioral_dimensions dimension
cross join generate_series(1, 5) expected(level_value)
left join public.tbos_dimension_levels level
  on level.dimension_id = dimension.id
  and level.level_value = expected.level_value
where level.dimension_id is null
  or level.description is null
  or btrim(level.description) = '';

select
  cls.relname as table_name,
  cls.relrowsecurity as rls_enabled,
  not (
    has_table_privilege('anon', format('public.%I', cls.relname), 'SELECT')
    or has_table_privilege('anon', format('public.%I', cls.relname), 'INSERT')
    or has_table_privilege('anon', format('public.%I', cls.relname), 'UPDATE')
    or has_table_privilege('anon', format('public.%I', cls.relname), 'DELETE')
  ) as anon_blocked,
  not (
    has_table_privilege('authenticated', format('public.%I', cls.relname), 'INSERT')
    or has_table_privilege('authenticated', format('public.%I', cls.relname), 'UPDATE')
    or has_table_privilege('authenticated', format('public.%I', cls.relname), 'DELETE')
  ) as authenticated_writes_blocked
from pg_class cls
join pg_namespace ns on ns.oid = cls.relnamespace
where ns.nspname = 'public'
  and cls.relkind in ('r', 'p')
order by cls.relname;
