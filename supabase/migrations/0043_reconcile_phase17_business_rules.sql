-- Reconcile the legacy Phase 1 business-rule snapshot with the configurable
-- governance decisions approved in Phase 17. This mutation only records policy
-- approval. Runtime controls, environment dry-run guards, release approval, and
-- pilot/live master switches remain independent safety gates.

begin;

create or replace function public.reconcile_phase17_business_rules(
  p_actor text
)
returns public.business_rule_sets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_actor text := lower(btrim(coalesce(p_actor, '')));
  base_rules jsonb;
  reconciled_rules jsonb;
  blockers jsonb := '[]'::jsonb;
  policy public.commercial_policy_settings%rowtype;
  owner_assignments jsonb := '{}'::jsonb;
  approval_assignments jsonb := '{}'::jsonb;
  risk_policies jsonb := '{}'::jsonb;
  owner_ready_count integer := 0;
  approval_ready_count integer := 0;
  risk_ready_count integer := 0;
  document_ready_count integer := 0;
  outreach_ready_count integer := 0;
  saved public.business_rule_sets%rowtype;
begin
  if length(normalized_actor) < 5 or position('@' in normalized_actor) < 2 then
    raise exception 'BUSINESS_RULE_ACTOR_INVALID' using errcode = '22023';
  end if;

  select rules into base_rules
  from public.business_rule_sets
  where is_mock = false
  order by
    case when status = 'active' then 0 else 1 end,
    created_at desc
  limit 1;

  if base_rules is null then
    raise exception 'BUSINESS_RULE_BASE_NOT_FOUND' using errcode = '55000';
  end if;

  select * into policy
  from public.commercial_policy_settings
  where setting_key = 'default';

  if policy.setting_key is null
    or policy.minimum_transaction_enabled is not true
    or policy.minimum_transaction_amount <> 15000000
    or policy.below_threshold_action <> 'approval_required'
    or policy.allow_admin_override is true
    or policy.override_requires_note is not true then
    blockers := blockers || '["commercial_policy_not_aligned"]'::jsonb;
  end if;

  select
    count(*) filter (
      where active = true
        and nullif(btrim(coalesce(owner_email, '')), '') is not null
    ),
    coalesce(
      jsonb_object_agg(
        function_key,
        jsonb_build_object(
          'label', label,
          'ownerEmail', owner_email,
          'backupEmail', backup_email,
          'escalationChannel', escalation_channel,
          'active', active,
          'version', version
        )
      ),
      '{}'::jsonb
    )
  into owner_ready_count, owner_assignments
  from public.governance_assignments;

  if owner_ready_count <> 7 then
    blockers := blockers || '["governance_owner_assignments_incomplete"]'::jsonb;
  end if;

  select
    count(*) filter (
      where active = true
        and nullif(btrim(coalesce(primary_approver_email, '')), '') is not null
    ),
    coalesce(
      jsonb_object_agg(
        approval_key,
        jsonb_build_object(
          'label', label,
          'primaryApproverEmail', primary_approver_email,
          'delegateEmail', delegate_email,
          'validFrom', valid_from,
          'validUntil', valid_until,
          'conditions', conditions,
          'active', active,
          'version', version
        )
      ),
      '{}'::jsonb
    )
  into approval_ready_count, approval_assignments
  from public.approval_delegations;

  if approval_ready_count <> 6 then
    blockers := blockers || '["approval_assignments_incomplete"]'::jsonb;
  end if;

  select
    count(*) filter (
      where enabled = true
        and nullif(btrim(coalesce(owner_email, '')), '') is not null
    ),
    coalesce(
      jsonb_object_agg(
        severity,
        jsonb_build_object(
          'label', label,
          'enabled', enabled,
          'acknowledgmentMinutes', acknowledgment_minutes,
          'initialReviewMinutes', initial_review_minutes,
          'backupEscalationMinutes', backup_escalation_minutes,
          'finalDecisionMinutes', final_decision_minutes,
          'businessHoursOnly', business_hours_only,
          'timeZone', time_zone,
          'escalationChannels', escalation_channels,
          'ownerEmail', owner_email,
          'version', version
        )
      ),
      '{}'::jsonb
    )
  into risk_ready_count, risk_policies
  from public.risk_sla_policies;

  if risk_ready_count <> 4 then
    blockers := blockers || '["risk_sla_policies_incomplete"]'::jsonb;
  end if;

  select count(distinct template_key)
  into document_ready_count
  from public.document_templates
  where template_key in ('proposal_finance_legal_clause', 'invoice_finance_legal_clause')
    and status = 'approved'
    and approved_by is not null
    and approved_at is not null;

  if document_ready_count <> 2 then
    blockers := blockers || '["finance_legal_wording_incomplete"]'::jsonb;
  end if;

  select count(distinct locale || ':' || template_key)
  into outreach_ready_count
  from public.outreach_templates
  where template_key in (
      'inquiry_follow_up_1',
      'inquiry_follow_up_2',
      'inquiry_follow_up_3',
      'assessment_result_follow_up_1',
      'assessment_result_follow_up_2',
      'assessment_result_follow_up_3',
      'assessment_proposal_follow_up_1',
      'assessment_proposal_follow_up_2',
      'assessment_proposal_follow_up_3'
    )
    and locale in ('id', 'en')
    and status = 'approved'
    and is_mock = false
    and owner is not null
    and approved_by is not null
    and approved_at is not null;

  if outreach_ready_count <> 18 then
    blockers := blockers || '["outreach_templates_incomplete"]'::jsonb;
  end if;

  reconciled_rules := base_rules || jsonb_build_object(
    'approvalState', case when jsonb_array_length(blockers) = 0 then 'approved_interim' else 'alignment_required' end,
    'minimumTransactionEnabled', coalesce(policy.minimum_transaction_enabled, true),
    'minimumTransaction', coalesce(policy.minimum_transaction_amount, 15000000),
    'minimumTransactionPolicy', coalesce(policy.below_threshold_action, 'approval_required'),
    'belowThresholdAction', coalesce(policy.below_threshold_action, 'approval_required'),
    'routeCatalogModuleId', policy.route_catalog_module_id,
    'currency', coalesce(policy.currency, 'IDR'),
    'proposalValidityDays', coalesce(policy.proposal_validity_days, 14),
    'allowAdminOverride', coalesce(policy.allow_admin_override, false),
    'overrideRequiresNote', coalesce(policy.override_requires_note, true),
    'catalog', coalesce(base_rules -> 'catalog', '{}'::jsonb) || jsonb_build_object(
      'managementMode', 'admin_managed',
      'productSource', 'catalog_products',
      'moduleSource', 'catalog_modules',
      'contentReadinessEvaluatedPerModule', true
    ),
    'ownership', jsonb_build_object(
      'mode', 'single_owner_interim',
      'backupPolicy', 'optional_until_team_expands',
      'assignments', owner_assignments
    ),
    'approvalGovernance', jsonb_build_object(
      'mode', 'human_gate',
      'delegationPolicy', 'disabled_unless_explicitly_configured',
      'assignments', approval_assignments
    ),
    'serviceLevels', coalesce(base_rules -> 'serviceLevels', '{}'::jsonb) || jsonb_build_object(
      'source', 'risk_sla_policies',
      'riskPolicies', risk_policies
    ),
    'tax', coalesce(base_rules -> 'tax', '{}'::jsonb) || jsonb_build_object(
      'finalWordingRequiresFinanceLegalConfirmation', false,
      'wordingSource', 'document_templates',
      'approvedTemplateCount', document_ready_count
    ),
    'followUp', coalesce(base_rules -> 'followUp', '{}'::jsonb) || jsonb_build_object(
      'templateSource', 'outreach_templates',
      'approvedTemplateCount', outreach_ready_count,
      'templateOwnerPolicy', 'governance_assignment'
    ),
    'activation', jsonb_build_object(
      'proposalAutoSendEnabled', false,
      'outboundAutomationEnabled', jsonb_array_length(blockers) = 0,
      'runtimeControlRequired', true,
      'releaseApprovalRequired', true,
      'pilotMasterSwitchRequired', true,
      'liveMasterSwitchRequired', true,
      'blockers', blockers
    ),
    'decisionMetadata', jsonb_build_object(
      'decisionSource', 'phase17_default_governance',
      'decisionActor', normalized_actor,
      'ceoReviewMode', 'post_implementation_review',
      'reconciledAt', now()
    )
  );

  -- Reconciliation is fail-closed: superseded active snapshots are archived.
  -- If any current governance record is incomplete, the new version remains a
  -- draft with explicit blockers and outbound permission stays false.
  update public.business_rule_sets
  set status = 'archived', updated_at = now()
  where status = 'active'
    and version <> 'v1.1-default-governance';

  insert into public.business_rule_sets (
    version,
    status,
    is_mock,
    rules,
    effective_at,
    approved_by,
    approved_at
  ) values (
    'v1.1-default-governance',
    case when jsonb_array_length(blockers) = 0 then 'active' else 'draft' end,
    false,
    reconciled_rules,
    case when jsonb_array_length(blockers) = 0 then now() else null end,
    case when jsonb_array_length(blockers) = 0 then normalized_actor else null end,
    case when jsonb_array_length(blockers) = 0 then now() else null end
  )
  on conflict (version) do update
  set status = excluded.status,
      is_mock = false,
      rules = excluded.rules,
      effective_at = excluded.effective_at,
      approved_by = excluded.approved_by,
      approved_at = excluded.approved_at,
      updated_at = now()
  returning * into saved;

  return saved;
end;
$$;

revoke all on function public.reconcile_phase17_business_rules(text)
  from public, anon, authenticated;
grant execute on function public.reconcile_phase17_business_rules(text)
  to service_role;

comment on function public.reconcile_phase17_business_rules(text) is
  'Builds the canonical v1.1 rule set from current Phase 17 governance records. It never changes runtime mode, environment guards, release state, or pilot/live switches.';

commit;
