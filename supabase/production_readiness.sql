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
  (
    to_regclass('public.client_accounts') is not null
    and to_regclass('public.client_stakeholders') is not null
    and to_regclass('public.project_milestones') is not null
    and to_regclass('public.account_health_reviews') is not null
    and to_regclass('public.retention_opportunities') is not null
    and to_regclass('public.client_activities') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'client_account_id'
    )
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'delivery_stage'
    )
    and to_regprocedure('public.convert_won_lead_to_client(uuid,text,text,text,text,date)') is not null
    and to_regprocedure('public.update_client_account(uuid,text,text,text,text,date,date,text,text,text)') is not null
    and to_regprocedure('public.save_client_stakeholder(uuid,uuid,text,text,text,text,text,text,text,boolean,boolean,text)') is not null
    and to_regprocedure('public.update_delivery_project(uuid,text,text,text,date,date,text,jsonb,text,text,text)') is not null
    and to_regprocedure('public.save_delivery_milestone(uuid,uuid,text,text,text,text,date,text,integer,numeric,text)') is not null
    and to_regprocedure('public.record_account_health_review(uuid,uuid,text,integer,integer,integer,integer,text,text[],text,text,date)') is not null
    and to_regprocedure('public.save_retention_opportunity(uuid,uuid,uuid,text,text,text,text,jsonb,numeric,date,text,timestamptz,text,boolean,text)') is not null
  ) as client_delivery_phase3_ready,
  (
    to_regprocedure('public.convert_won_lead_to_client(uuid,text,text,text,text,date)') is not null
    and position(
      'jsonb_populate_record' in lower(pg_get_functiondef(to_regprocedure('public.convert_won_lead_to_client(uuid,text,text,text,text,date)')))
    ) > 0
  ) as client_handoff_source_id_compatibility_ready,
  (
    to_regclass('public.operational_tasks') is not null
    and to_regclass('public.operational_task_events') is not null
    and to_regclass('public.automation_runs') is not null
    and to_regprocedure('public.sync_client_operations_tasks(text,boolean,date)') is not null
    and to_regprocedure('public.update_operational_task(uuid,text,text,text,text,timestamptz,text)') is not null
  ) as automation_control_phase4_ready,
  (
    to_regclass('public.acquisition_sources') is not null
    and to_regclass('public.acquisition_campaigns') is not null
    and to_regclass('public.prospect_import_batches') is not null
    and to_regclass('public.acquisition_prospects') is not null
    and to_regclass('public.acquisition_events') is not null
    and to_regprocedure('public.save_acquisition_source(uuid,text,text,text,text,text,text,text,text,integer,text,text,text,boolean,jsonb,boolean,text)') is not null
    and to_regprocedure('public.save_acquisition_campaign(uuid,text,uuid,text,text,text,text,text,text,numeric,text,date,date,jsonb,jsonb,boolean,text)') is not null
    and to_regprocedure('public.stage_acquisition_batch(uuid,uuid,text,text,text,jsonb,text)') is not null
    and to_regprocedure('public.review_acquisition_batch(uuid,text,text,text)') is not null
    and to_regprocedure('public.promote_acquisition_batch(uuid,text,boolean)') is not null
  ) as acquisition_governance_phase5_ready,
  (
    exists (
      select 1
      from public.catalog_modules module
      join public.catalog_products product on product.id = module.product_id
      where module.module_code = 'BI-PUBLIC'
        and module.is_mock = false
        and module.active
        and module.readiness_status = 'ready'
        and module.catalog_version = 'v1.0-public'
        and product.product_key = 'binainsight'
        and product.status = 'ready'
    )
    and not exists (
      select 1
      from public.catalog_modules
      where active
        and readiness_status = 'ready'
        and not is_mock
        and catalog_version ilike '%mock%'
    )
  ) as public_catalog_phase6_ready,
  (
    to_regprocedure('public.sync_client_operations_tasks(text,boolean,date)') is not null
    and position(
      'null::uuid' in lower(pg_get_functiondef(to_regprocedure('public.sync_client_operations_tasks(text,boolean,date)')))
    ) > 0
  ) as client_operations_phase7_ready,
  (
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'calendar_bookings'
        and column_name = 'provider_series_uid'
    )
    and to_regclass('public.calendar_bookings_series_idx') is not null
  ) as calendar_booking_lineage_phase7_ready,
  (
    to_regclass('public.uat_scenarios') is not null
    and to_regclass('public.uat_scenario_events') is not null
    and to_regprocedure('public.update_uat_scenario(uuid,text,text,text,text,text,text,text,text)') is not null
    and (select count(*) from public.uat_scenarios where required) >= 12
  ) as human_uat_pilot_gate_phase9_ready,
  (
    to_regclass('public.pilot_release_plans') is not null
    and to_regclass('public.pilot_release_events') is not null
    and to_regclass('public.automation_runtime_controls') is not null
    and to_regclass('public.automation_runtime_control_events') is not null
    and to_regprocedure('public.save_pilot_release_plan(uuid,text,text,text,text,integer,timestamptz,timestamptz,text,text,text,jsonb,jsonb,text,boolean)') is not null
    and to_regprocedure('public.transition_pilot_release_plan(uuid,text,text,text)') is not null
    and to_regprocedure('public.set_automation_runtime_control(text,text,text,integer,text,uuid,boolean,text,text,text)') is not null
    and to_regprocedure('public.create_limited_client_operations_tasks(text,jsonb)') is not null
    and (
      select count(*)
      from public.automation_runtime_controls
      where workflow_key in (
        'follow_up_scheduler',
        'transformation_event_worker',
        'client_operations_daily',
        'acquisition_batch_processor'
      )
    ) = 4
  ) as pilot_operations_phase10_ready,
  (
    to_regclass('public.automation_monitoring_policies') is not null
    and to_regclass('public.automation_monitoring_policy_events') is not null
    and to_regclass('public.pilot_monitoring_snapshots') is not null
    and to_regclass('public.automation_incidents') is not null
    and to_regclass('public.automation_incident_events') is not null
    and to_regclass('public.pilot_go_no_go_reviews') is not null
    and to_regprocedure('public.save_automation_monitoring_policy(text,text,integer,integer,numeric,integer,integer,boolean,text,boolean)') is not null
    and to_regprocedure('public.record_pilot_monitoring_snapshot(uuid,text,text,timestamptz,timestamptz,text,jsonb,jsonb,jsonb,boolean,boolean)') is not null
    and to_regprocedure('public.upsert_automation_incident(text,text,uuid,text,text,text,uuid,text,text)') is not null
    and to_regprocedure('public.update_automation_incident(uuid,text,text,text,text,text)') is not null
    and to_regprocedure('public.record_pilot_go_no_go_review(uuid,uuid,text,text,jsonb,text)') is not null
    and (select count(*) from public.automation_monitoring_policies) = 4
  ) as operational_assurance_phase11_ready,
  (
    to_regclass('public.pilot_rehearsals') is not null
    and to_regclass('public.pilot_rehearsal_steps') is not null
    and to_regclass('public.pilot_rehearsal_events') is not null
    and to_regclass('public.pilot_acceptance_certifications') is not null
    and to_regclass('public.pilot_acceptance_events') is not null
    and to_regprocedure('public.save_pilot_rehearsal(uuid,uuid,text,text,text,text,text,boolean,text)') is not null
    and to_regprocedure('public.update_pilot_rehearsal_step(uuid,text,text,text,text,text,text,text)') is not null
    and to_regprocedure('public.transition_pilot_rehearsal(uuid,text,text,uuid,text,text,text)') is not null
    and to_regprocedure('public.record_pilot_acceptance_certification(uuid,uuid,uuid,text,text,jsonb,text,boolean)') is not null
    and exists (
      select 1 from pg_trigger
      where tgname = 'pilot_go_no_go_reviews_phase12_acceptance_gate' and not tgisinternal
    )
    and exists (
      select 1 from pg_trigger
      where tgname = 'pilot_release_plans_phase12_acceptance_gate' and not tgisinternal
    )
    and exists (
      select 1 from pg_trigger
      where tgname = 'automation_runtime_controls_phase12_acceptance_gate' and not tgisinternal
    )
  ) as pilot_certification_phase12_ready,
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

select count(*) as uat_definition_issues
from public.uat_scenarios scenario
where scenario.title is null
  or btrim(scenario.title) = ''
  or scenario.objective is null
  or btrim(scenario.objective) = ''
  or scenario.expected_result is null
  or btrim(scenario.expected_result) = ''
  or (scenario.required and scenario.status = 'not_applicable')
  or not exists (
    select 1
    from public.uat_scenario_events event
    where event.scenario_id = scenario.id
      and event.event_type = 'created'
  );

select
  count(*) filter (where required) as uat_required_total,
  count(*) filter (where required and status = 'passed') as uat_required_passed,
  count(*) filter (where required and status <> 'passed') as uat_required_pending_for_human_execution
from public.uat_scenarios;

select
  (
    4 - count(*)
  ) + count(*) filter (
    where requested_mode in ('pilot', 'live')
      and (
        pilot_release_id is null
        or owner is null
        or approval_note is null
        or rollback_plan is null
        or approved_by is null
        or approved_at is null
      )
  ) + count(*) filter (
    where not exists (
      select 1
      from public.automation_runtime_control_events event
      where event.workflow_key = automation_runtime_controls.workflow_key
        and event.event_type = 'seeded'
    )
  ) as pilot_operations_definition_issues
from public.automation_runtime_controls;

select
  count(*) filter (where requested_mode = 'disabled') as runtime_controls_disabled,
  count(*) filter (where requested_mode = 'dry_run') as runtime_controls_requested_dry_run,
  count(*) filter (where requested_mode = 'pilot') as runtime_controls_requested_pilot,
  count(*) filter (where requested_mode = 'live') as runtime_controls_requested_live,
  count(*) filter (
    where requested_mode in ('pilot', 'live')
      and not exists (
        select 1
        from public.pilot_release_plans release
        where release.id = automation_runtime_controls.pilot_release_id
          and release.status in ('approved', 'scheduled')
          and release.is_mock = false
      )
  ) as active_runtime_release_issues
from public.automation_runtime_controls;

select
  count(*) as pilot_release_total,
  count(*) filter (where status in ('approved', 'scheduled') and is_mock = false) as pilot_release_approved_or_scheduled,
  count(*) filter (where status in ('approved', 'scheduled') and is_mock = true) as pilot_release_mock_approval_issues
from public.pilot_release_plans;

select
  (4 - count(*))
  + count(*) filter (
    where not exists (
      select 1 from public.automation_monitoring_policy_events event
      where event.workflow_key = automation_monitoring_policies.workflow_key
        and event.event_type = 'seeded'
    )
  ) as operational_assurance_definition_issues,
  count(*) filter (where is_mock or owner is null or not enabled) as monitoring_policy_pending_for_human_approval
from public.automation_monitoring_policies;

select
  count(*) as monitoring_snapshot_total,
  count(*) filter (where not is_mock) as monitoring_snapshot_real_total,
  count(*) filter (where overall_status = 'healthy' and not is_mock) as monitoring_snapshot_real_healthy_total
from public.pilot_monitoring_snapshots;

select
  count(*) filter (where status not in ('resolved', 'dismissed')) as incident_open_total,
  count(*) filter (where status not in ('resolved', 'dismissed') and severity = 'critical') as incident_open_critical_issues,
  count(*) filter (
    where status in ('investigating', 'monitoring') and owner is null
  ) as incident_owner_issues
from public.automation_incidents;

select count(*) as active_go_no_go_review_issues
from public.pilot_go_no_go_reviews review
join public.pilot_monitoring_snapshots snapshot on snapshot.id = review.monitoring_snapshot_id
where review.decision in ('go', 'conditional_go')
  and (
    snapshot.is_mock
    or snapshot.evaluated_at < now() - interval '24 hours'
    or snapshot.overall_status in ('critical', 'insufficient_data')
    or exists (
      select 1 from public.automation_incidents incident
      where incident.status not in ('resolved', 'dismissed')
        and incident.severity = 'critical'
        and (incident.pilot_release_id is null or incident.pilot_release_id = review.pilot_release_id)
    )
  );

select
  count(*) as pilot_rehearsal_total,
  count(*) filter (where environment = 'production' and not is_mock) as pilot_rehearsal_real_total,
  count(*) filter (where status = 'passed' and environment = 'production' and not is_mock) as pilot_rehearsal_real_passed_total,
  count(*) filter (where status = 'passed' and monitoring_snapshot_id is null) as pilot_rehearsal_snapshot_issues
from public.pilot_rehearsals;

select count(*) as pilot_rehearsal_definition_issues
from public.pilot_rehearsals rehearsal
where (
  select count(*)
  from public.pilot_rehearsal_steps step
  where step.rehearsal_id = rehearsal.id
    and step.required
) <> 8;

select count(*) as pilot_rehearsal_step_evidence_issues
from public.pilot_rehearsal_steps
where status in ('passed', 'failed')
  and (
    evidence_note is null or length(btrim(evidence_note)) < 5
    or actual_result is null or length(btrim(actual_result)) < 5
    or last_tested_at is null
    or last_tested_by is null
  );

select
  count(*) as pilot_acceptance_certification_total,
  count(*) filter (where decision in ('accepted', 'accepted_with_conditions') and not is_mock) as pilot_acceptance_real_total,
  count(*) filter (
    where decision in ('accepted', 'accepted_with_conditions')
      and (
        is_mock
        or jsonb_typeof(uat_evidence_snapshot) <> 'array'
        or jsonb_array_length(uat_evidence_snapshot) < 12
      )
  ) as pilot_acceptance_evidence_issues
from public.pilot_acceptance_certifications;

select count(*) as pilot_acceptance_binding_issues
from public.pilot_acceptance_certifications certification
join public.pilot_rehearsals rehearsal on rehearsal.id = certification.rehearsal_id
join public.pilot_monitoring_snapshots snapshot on snapshot.id = certification.monitoring_snapshot_id
where certification.decision in ('accepted', 'accepted_with_conditions')
  and (
    rehearsal.pilot_release_id <> certification.pilot_release_id
    or rehearsal.monitoring_snapshot_id <> certification.monitoring_snapshot_id
    or rehearsal.status <> 'passed'
    or rehearsal.is_mock
    or snapshot.is_mock
    or snapshot.overall_status in ('critical', 'insufficient_data')
  );

-- Configurable commercial/governance controls introduced in migration 0039.
-- Pending values are reported explicitly; they do not silently become approved defaults.
select
  count(*) filter (where minimum_transaction_enabled) as minimum_transaction_policy_enabled,
  count(*) filter (
    where minimum_transaction_enabled
      and minimum_transaction_amount <= 0
  ) as minimum_transaction_policy_issues,
  max(version) as commercial_policy_version
from public.commercial_policy_settings;

select
  count(*) as governance_assignment_total,
  count(*) filter (where active and owner_email is null) as governance_owner_pending,
  count(*) filter (
    where active
      and owner_user_id is not null
      and backup_user_id is not null
      and owner_user_id = backup_user_id
  ) as governance_backup_conflict_issues
from public.governance_assignments;

select
  count(*) as approval_rule_total,
  count(*) filter (where active) as approval_rule_active_total,
  count(*) filter (where active and primary_approver_email is null) as approval_rule_owner_issues,
  count(*) filter (
    where active
      and valid_until is not null
      and valid_until <= now()
  ) as approval_delegation_expired_issues
from public.approval_delegations;

select
  count(*) as risk_sla_total,
  count(*) filter (where enabled) as risk_sla_enabled_total,
  count(*) filter (where enabled and owner_email is null) as risk_sla_owner_issues
from public.risk_sla_policies;

select
  count(*) as finance_legal_template_total,
  count(*) filter (where status = 'approved') as finance_legal_template_approved_total,
  count(*) filter (
    where status = 'approved'
      and (approved_by is null or approved_at is null or length(btrim(approval_note)) < 5)
  ) as finance_legal_template_approval_issues
from public.document_templates;

select
  count(*) as program_questionnaire_total,
  count(*) filter (where status = 'published') as program_questionnaire_published_total,
  count(*) filter (
    where status = 'published'
      and not exists (
        select 1
        from public.program_questionnaire_questions question
        where question.questionnaire_id = program_questionnaires.id
      )
  ) as published_questionnaire_without_questions_issues
from public.program_questionnaires;

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
