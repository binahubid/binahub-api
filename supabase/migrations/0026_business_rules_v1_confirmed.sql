-- Business Rules v1 confirmed decisions with explicit activation blockers.
-- The rule set is intentionally draft: catalog modules, prices, ownership, and
-- several approval details are still open and must not be guessed by the system.

begin;

alter table public.leads
  add column if not exists lead_score_confidence numeric(4,3),
  add column if not exists lead_score_reason text,
  add column if not exists lead_score_evidence jsonb not null default '{}'::jsonb,
  add column if not exists lead_score_rule_version text;

alter table public.leads
  drop constraint if exists leads_score_confidence_valid;
alter table public.leads
  add constraint leads_score_confidence_valid
  check (lead_score_confidence is null or lead_score_confidence between 0 and 1) not valid;

create index if not exists leads_score_rule_version_idx
  on public.leads (lead_score_rule_version, lead_temperature, lead_score desc nulls last);

alter table public.follow_up_events
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

update public.follow_up_events event
set lead_id = inquiry.lead_id
from public.inquiries inquiry
where event.target_type = 'inquiry'
  and event.target_id = inquiry.id
  and event.lead_id is null;

update public.follow_up_events event
set lead_id = assessment.lead_id
from public.assessments assessment
where event.target_type = 'assessment'
  and event.target_id = assessment.id
  and event.lead_id is null;

create index if not exists follow_up_events_lead_idx
  on public.follow_up_events (lead_id, sent_at desc)
  where lead_id is not null;

alter table public.follow_up_claims
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

update public.follow_up_claims claim
set lead_id = inquiry.lead_id
from public.inquiries inquiry
where claim.target_type = 'inquiry'
  and claim.target_id = inquiry.id
  and claim.lead_id is null;

update public.follow_up_claims claim
set lead_id = assessment.lead_id
from public.assessments assessment
where claim.target_type = 'assessment'
  and claim.target_id = assessment.id
  and claim.lead_id is null;

create index if not exists follow_up_claims_lead_idx
  on public.follow_up_claims (lead_id, status)
  where lead_id is not null;

create or replace function public.claim_follow_up_delivery(
  p_target_type text,
  p_target_id uuid,
  p_channel text,
  p_level integer,
  p_actor text,
  p_lead_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  opportunity_key text := coalesce(p_lead_id::text, p_target_type || ':' || p_target_id::text);
  existing_claims integer;
begin
  if p_target_type not in ('inquiry', 'assessment')
    or p_channel not in ('inquiry', 'result', 'proposal')
    or p_level not between 1 and 3
    or p_actor is null
    or length(btrim(p_actor)) < 3 then
    raise exception 'INVALID_FOLLOW_UP_CLAIM' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(opportunity_key, 0));

  select count(*) into existing_claims
  from public.follow_up_claims claim
  where claim.status in ('processing', 'sent', 'delivery_unconfirmed')
    and (
      (p_lead_id is not null and claim.lead_id = p_lead_id)
      or (
        p_lead_id is null
        and claim.target_type = p_target_type
        and claim.target_id = p_target_id
      )
    );

  if existing_claims >= 3 then
    raise exception 'MAX_FOLLOW_UP_MESSAGES_REACHED' using errcode = 'P0001';
  end if;

  insert into public.follow_up_claims (
    target_type, target_id, lead_id, channel, level, status, actor
  ) values (
    p_target_type, p_target_id, p_lead_id, p_channel, p_level, 'processing', btrim(p_actor)
  );
end;
$$;

revoke all on function public.claim_follow_up_delivery(text, uuid, text, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_follow_up_delivery(text, uuid, text, integer, text, uuid)
  to service_role;

insert into public.business_rule_sets (version, status, is_mock, rules)
values (
  'v1.0-approved-partial',
  'draft',
  false,
  $rules$
  {
    "approvalState": "approved_with_open_items",
    "currency": "IDR",
    "minimumTransaction": 15000000,
    "minimumTransactionPolicy": "pending_discussion",
    "proposalValidityDays": 14,
    "tax": {
      "pricesExcludePph23Percent": 2,
      "vatStatus": "not_pkp",
      "finalWordingRequiresFinanceLegalConfirmation": true
    },
    "separateCosts": [
      "travel",
      "accommodation",
      "venue",
      "consumption_outside_scope",
      "third_party_license_or_platform",
      "electronic_equipment",
      "special_client_requirements",
      "other_explicit_out_of_scope_costs"
    ],
    "icp": {
      "industries": "general",
      "excludedIndustries": [
        "tobacco",
        "alcoholic_beverages",
        "non_bpjs_insurance",
        "conventional_banking",
        "online_lending"
      ],
      "minimumCompanySize": 20,
      "maximumCompanySize": null,
      "country": "Indonesia",
      "priorityLocations": ["Jabodetabek", "major_cities", "industrial_hubs"],
      "otherIndonesiaLocationsAccepted": true,
      "decisionMakerRoles": [
        "CEO/Owner",
        "Director",
        "VP",
        "Senior Manager",
        "Head/Head of Function",
        "HR Director/Head",
        "CHRO/CPO",
        "Head L&D/OD/Talent",
        "Business Unit Director/Head",
        "other role with authority and budget"
      ],
      "championRoles": [
        "HRBP",
        "L&D Manager",
        "OD Manager",
        "Talent Management Manager",
        "People Development Manager",
        "Training Manager",
        "Corporate/Learning Academy",
        "Project Manager",
        "Transformation Manager",
        "Business Unit Head",
        "Strategic Office/Project Coordinator"
      ],
      "positiveSignals": [
        "transformation",
        "merger_or_restructure",
        "leadership_pipeline",
        "productivity",
        "culture_change",
        "ai_adoption",
        "upskilling_or_reskilling",
        "engagement"
      ],
      "otherExclusions": [
        "outside_binahub_competency_or_positioning",
        "unsubstantiated_outcome_claim",
        "legal_reputational_ethical_or_conflict_risk",
        "unrealistic_scope",
        "inquiry_without_adequate_need_or_authority"
      ]
    },
    "leadQualification": {
      "ruleVersion": "v1.0-confirmed-partial",
      "thresholds": {"hot": 75, "warm": 50, "cold": 0},
      "minimumBuyingSignals": 3,
      "buyingSignals": [
        "clear_problem",
        "timeline",
        "decision_maker_or_sponsor",
        "budget_willingness",
        "meeting_or_diagnostic_need",
        "business_consequence"
      ],
      "hotMandatoryConditions": [
        "clear_problem",
        "clear_timeline",
        "decision_maker_or_sponsor",
        "next_step_or_meeting"
      ],
      "reevaluateWithConversionData": true
    },
    "catalog": {
      "pricingLevel": "module",
      "productUmbrellas": [
        "BinaInsight",
        "BinaLab",
        "BinaCoach",
        "BinaPlay",
        "BinaAcademy",
        "BinaWorks",
        "BinaImpact"
      ],
      "productStatuses": null,
      "moduleCatalog": null,
      "moduleOwnerRole": "Product Owner",
      "automatedProposalRequiresReadyToSell": true,
      "readyToSellRequirements": [
        "approved_scope",
        "approved_output",
        "approved_boundaries",
        "delivery_capacity",
        "pricing_unit",
        "base_price",
        "minimum_quantity",
        "delivery_requirements",
        "owner",
        "version"
      ],
      "bundlePolicy": {
        "requiresStrategicOrOperationalSynergy": true,
        "officialPricingMatrixOnlyForAutomation": true,
        "customBundleRequiresHumanReview": true
      }
    },
    "humanGate": {
      "alwaysRequireApprovalForMock": true,
      "standardAutoSendPolicyApproved": true,
      "allowStandardAutoSend": false,
      "highDealThreshold": 100000000,
      "maxDiscountWithoutApproval": 5,
      "absoluteMaxDiscount": 10,
      "lowConfidenceThreshold": 0.75,
      "approverRoles": ["CEO", "Commercial Director"],
      "requiredProposalData": [
        "organizationName",
        "problemOrNeed",
        "objective",
        "participantEstimate",
        "targetAudience",
        "scope",
        "timeline",
        "decisionMakerOrSponsor",
        "budgetIndication",
        "deliveryLocationOrMode",
        "expectedOutcome",
        "nextStep"
      ],
      "nonOverridableUntilResolved": [
        "incomplete_required_data",
        "module_not_ready",
        "discount_above_absolute_maximum"
      ],
      "overrideAuditRequired": ["actor", "timestamp", "before", "after", "reason"]
    },
    "followUp": {
      "levels": [2, 7, 14],
      "maxMessagesPerOpportunity": 3,
      "channels": ["email"],
      "timeZoneFallback": "Asia/Jakarta",
      "useLeadTimeZoneWhenAvailable": true,
      "weekdays": [1, 2, 3, 4, 5],
      "sendWindow": {"start": "08:00", "end": "17:00"},
      "stopConditions": [
        "reply",
        "meeting_booked_or_rescheduled",
        "pause",
        "active_negotiation",
        "proposal_accepted",
        "won_lost_or_closed",
        "unsubscribe",
        "bounce",
        "complaint",
        "duplicate_lead_or_opportunity",
        "legal_privacy_or_reputation_risk",
        "human_takeover"
      ],
      "resumeRequiresAuthorizedHuman": true,
      "resumeDoesNotRestartAtH2": true,
      "salesUnsubscribeIsPermanent": true,
      "defaultLanguage": "id",
      "englishWhenLeadContextIsEnglish": true,
      "singleCallToAction": true,
      "templateMustBeVersionedAndApproved": true
    },
    "serviceLevels": {
      "hotReviewBusinessHours": 2,
      "warmReviewBusinessDays": 1,
      "standardProposalBusinessDays": 1,
      "customProposalBusinessDaysAfterCompleteData": 3,
      "largeDealOrDiscountApprovalBusinessDays": 2,
      "dealToDeliveryHandoffBusinessDays": 1,
      "legalOrReputationReview": null,
      "escalation": {
        "remindOwnerAtPercent": 50,
        "escalateBackupAtPercent": 100,
        "thenEscalateFinalDecisionMaker": true,
        "channels": ["notification", "email"]
      }
    },
    "ownership": {
      "salesOperationsOwner": null,
      "proposalOwner": null,
      "deliverabilityOwner": null,
      "deliveryOwner": null,
      "backupOwners": null,
      "templateOwner": null,
      "finalConflictAuthority": "CEO"
    },
    "activation": {
      "proposalAutoSendEnabled": false,
      "outboundAutomationEnabled": false,
      "blockers": [
        "official_product_statuses",
        "official_module_catalog",
        "module_scope_output_unit_price_and_status",
        "minimum_transaction_below_threshold_policy",
        "individual_owner_and_backup_assignments",
        "individual_approver_assignments",
        "legal_reputation_review_sla",
        "follow_up_template_owner_and_final_approval",
        "finance_legal_tax_wording"
      ]
    }
  }
  $rules$::jsonb
)
on conflict (version) do update
set rules = excluded.rules,
    is_mock = false,
    status = case
      when business_rule_sets.status = 'active' then business_rule_sets.status
      else 'draft'
    end;

commit;
