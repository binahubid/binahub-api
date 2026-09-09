import type { SupabaseClient } from "@supabase/supabase-js";
import { refineLeadDiscoveryScoreWithAI } from "@/lib/ai-service";
import { getLeadDiscoveryConfig, publicLeadDiscoveryConfig, type LeadDiscoveryConfig } from "@/lib/lead-discovery-config";
import { enrichLeadDiscoveryCandidate, searchLeadDiscoveryCandidates } from "@/lib/lead-discovery-provider";
import {
  isAllowedWorkEmail,
  scoreLeadDiscoveryCandidate,
  type DiscoveryCandidate,
  type LeadDiscoveryIcp,
} from "@/lib/lead-discovery-scoring";

type JsonObject = Record<string, unknown>;
type RuleRecord = { id: string; version: string; rules: JsonObject | null };
type CandidateState = {
  candidate: DiscoveryCandidate;
  fitScore: number;
  confidence: number;
  status: "company_review" | "eligible" | "excluded" | "duplicate" | "suppressed" | "no_work_email" | "staged";
  matchReasons: string[];
  exclusionReasons: string[];
  evidence: JsonObject;
  aiReasoning: string | null;
  aiScoreAdjustment: number;
};

export class LeadDiscoveryError extends Error {
  constructor(message: string, public readonly code: string, public readonly status = 400) {
    super(message);
  }
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function strings(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return fallback;
}

function integer(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

function nullableInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Lead discovery gagal dijalankan.";
  const secrets = [
    process.env.APOLLO_API_KEY,
    process.env.HUNTER_API_KEY,
    process.env.CODECRAFT_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.LEAD_AGENT_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), message).slice(0, 1500);
}

function jakartaDayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${value.year}-${value.month}-${value.day}`;
  const start = new Date(`${date}T00:00:00+07:00`);
  return { date, start: start.toISOString(), end: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() };
}

function parseIcp(rule: RuleRecord): LeadDiscoveryIcp {
  const icp = record(rule.rules?.icp);
  const qualification = record(rule.rules?.leadQualification);
  return {
    industries: strings(icp.industries, ["general"]).map((value) => value.toLowerCase()),
    excludedIndustries: strings(icp.excludedIndustries),
    minimumCompanySize: Math.max(1, integer(icp.minimumCompanySize, 20)),
    maximumCompanySize: nullableInteger(icp.maximumCompanySize),
    country: typeof icp.country === "string" && icp.country.trim() ? icp.country.trim() : "Indonesia",
    priorityLocations: strings(icp.priorityLocations, ["Jabodetabek", "major_cities", "industrial_hubs"]),
    decisionMakerRoles: strings(icp.decisionMakerRoles),
    championRoles: strings(icp.championRoles),
    positiveSignals: strings(icp.positiveSignals),
    otherExclusions: strings(icp.otherExclusions),
    ruleVersion: typeof qualification.ruleVersion === "string" ? qualification.ruleVersion : rule.version,
  };
}

async function loadIcp(db: SupabaseClient) {
  const { data, error } = await db.from("business_rule_sets")
    .select("id,version,rules")
    .eq("status", "active")
    .eq("is_mock", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new LeadDiscoveryError(error.message, "ICP_LOAD_FAILED", 500);
  if (!data) throw new LeadDiscoveryError("ICP resmi belum tersedia.", "ICP_NOT_CONFIGURED", 503);
  const rule = data as RuleRecord;
  const icp = parseIcp(rule);
  if (!icp.decisionMakerRoles.length || !icp.championRoles.length) {
    throw new LeadDiscoveryError("ICP belum memiliki jabatan decision maker dan champion.", "ICP_INCOMPLETE", 503);
  }
  return { rule, icp };
}

export async function loadLeadDiscoveryGovernance(db: SupabaseClient, config: LeadDiscoveryConfig) {
  let sourceQuery = db.from("acquisition_sources").select("id,name,provider_type,status,active,lawful_basis,retention_days,data_owner");
  sourceQuery = config.sourceId ? sourceQuery.eq("id", config.sourceId) : sourceQuery.eq("source_key", config.sourceKey || "");
  const sourceResult = await sourceQuery.maybeSingle();
  const { data: source, error: sourceError } = sourceResult;
  if (sourceError) throw new LeadDiscoveryError(sourceError.message, "SOURCE_LOAD_FAILED", 500);
  if (!source || source.status !== "approved" || source.active !== true || !source.lawful_basis || !source.retention_days) {
    throw new LeadDiscoveryError("Sumber discovery harus aktif, disetujui, dan memiliki dasar pemrosesan.", "SOURCE_NOT_APPROVED", 409);
  }
  if (source.provider_type !== config.provider) {
    throw new LeadDiscoveryError(`Sumber discovery harus memakai provider ${config.provider}.`, "SOURCE_PROVIDER_MISMATCH", 409);
  }
  let campaignResult: { data: { id: string; name: string; status: string; source_id: string; owner: string } | null; error: { message: string } | null } = { data: null, error: null };
  if (config.campaignId || config.campaignCode) {
    let campaignQuery = db.from("acquisition_campaigns").select("id,name,status,source_id,owner");
    campaignQuery = config.campaignId ? campaignQuery.eq("id", config.campaignId) : campaignQuery.eq("campaign_code", config.campaignCode || "");
    campaignResult = await campaignQuery.maybeSingle();
  }
  if (campaignResult.error) throw new LeadDiscoveryError(campaignResult.error.message, "CAMPAIGN_LOAD_FAILED", 500);
  if ((config.campaignId || config.campaignCode) && (!campaignResult.data || campaignResult.data.source_id !== source.id || !["approved", "active"].includes(campaignResult.data.status))) {
    throw new LeadDiscoveryError("Kampanye discovery harus disetujui dan memakai sumber yang sama.", "CAMPAIGN_NOT_APPROVED", 409);
  }
  return { source, campaign: campaignResult.data };
}

async function applyExistingRecordControls(db: SupabaseClient, states: CandidateState[], provider: LeadDiscoveryConfig["provider"]) {
  const emails = states.map((item) => item.candidate.workEmail?.trim().toLowerCase()).filter((item): item is string => Boolean(item));
  const providerIds = states.map((item) => item.candidate.providerPersonId);
  const [leads, suppressions, stagedCandidates] = await Promise.all([
    emails.length ? db.from("leads").select("email").in("email", emails) : Promise.resolve({ data: [], error: null }),
    emails.length ? db.from("email_suppressions").select("email").in("email", emails) : Promise.resolve({ data: [], error: null }),
    providerIds.length ? db.from("lead_discovery_candidates").select("provider_person_id").eq("provider", provider).eq("status", "staged").in("provider_person_id", providerIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const queryError = leads.error || suppressions.error || stagedCandidates.error;
  if (queryError) throw new LeadDiscoveryError(queryError.message, "DUPLICATE_CONTROL_FAILED", 500);
  const existingEmails = new Set((leads.data || []).map((item) => String(item.email).trim().toLowerCase()));
  const suppressedEmails = new Set((suppressions.data || []).map((item) => String(item.email).trim().toLowerCase()));
  const stagedProviderIds = new Set((stagedCandidates.data || []).map((item) => String(item.provider_person_id)));

  return states.map((state) => {
    const email = state.candidate.workEmail?.trim().toLowerCase() || "";
    if (email && suppressedEmails.has(email)) return { ...state, status: "suppressed" as const, exclusionReasons: [...state.exclusionReasons, "Email ada dalam suppression list."] };
    if (stagedProviderIds.has(state.candidate.providerPersonId) || (email && existingEmails.has(email))) {
      return { ...state, status: "duplicate" as const, exclusionReasons: [...state.exclusionReasons, "Prospek sudah pernah di-stage atau sudah menjadi lead."] };
    }
    return state;
  });
}

function candidateRow(runId: string, state: CandidateState, provider: LeadDiscoveryConfig["provider"]) {
  const candidate = state.candidate;
  return {
    discovery_run_id: runId,
    provider,
    candidate_kind: candidate.candidateKind,
    provider_person_id: candidate.providerPersonId,
    provider_organization_id: candidate.providerOrganizationId,
    full_name: candidate.fullName,
    role_title: candidate.roleTitle,
    company: candidate.company,
    company_domain: candidate.companyDomain,
    industry: candidate.industry,
    location: candidate.location,
    employee_count: candidate.employeeCount,
    employee_range: candidate.employeeRange,
    work_email: candidate.workEmail,
    email_status: candidate.emailStatus,
    linkedin_url: candidate.linkedinUrl,
    source_url: candidate.sourceUrl,
    fit_score: state.fitScore,
    confidence: state.confidence,
    status: state.status,
    match_reasons: state.matchReasons,
    exclusion_reasons: state.exclusionReasons,
    evidence: state.evidence,
    ai_reasoning: state.aiReasoning,
    ai_score_adjustment: state.aiScoreAdjustment,
  };
}

function stagingProspect(state: CandidateState, provider: LeadDiscoveryConfig["provider"]) {
  const candidate = state.candidate;
  return {
    externalId: `${provider}:${candidate.providerPersonId}`,
    name: candidate.fullName,
    email: candidate.workEmail,
    company: candidate.company,
    roleTitle: candidate.roleTitle,
    industry: candidate.industry,
    location: candidate.location,
    employeeRange: candidate.employeeRange || (candidate.employeeCount === null ? null : String(candidate.employeeCount)),
    websiteUrl: candidate.sourceUrl,
    linkedinUrl: candidate.linkedinUrl,
    sourceUrl: candidate.linkedinUrl || candidate.sourceUrl,
    consentStatus: "unknown",
    discoveryEvidence: {
      fitScore: state.fitScore,
      confidence: state.confidence,
      matchReasons: state.matchReasons,
      ruleVersion: state.evidence.ruleVersion,
      provider,
    },
  };
}

export async function runLeadDiscovery(input: {
  db: SupabaseClient;
  actor: string;
  idempotencyKey: string;
  forceDryRun?: boolean;
  fetchImplementation?: typeof fetch;
}) {
  const config = getLeadDiscoveryConfig();
  const effectiveDryRun = input.forceDryRun === true || config.dryRun || !config.stagingEnabled;
  if (config.blockers.length) throw new LeadDiscoveryError(config.blockers.join(" "), "LEAD_AGENT_NOT_READY", 503);
  if (!config.sourceId && !config.sourceKey) throw new LeadDiscoveryError("Sumber discovery belum dipilih.", "SOURCE_NOT_CONFIGURED", 503);
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
    throw new LeadDiscoveryError("Idempotency key harus 8–200 karakter.", "INVALID_IDEMPOTENCY_KEY", 400);
  }

  const { data: existing, error: existingError } = await input.db.from("lead_discovery_runs")
    .select("*").eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existingError) throw new LeadDiscoveryError(existingError.message, "RUN_LOOKUP_FAILED", 500);
  let retryRun: typeof existing = null;
  if (existing) {
    if (existing.status !== "failed") return { duplicate: true, run: existing, candidates: [] };
    const { count, error: candidateCountError } = await input.db.from("lead_discovery_candidates")
      .select("id", { count: "exact", head: true }).eq("discovery_run_id", existing.id);
    if (candidateCountError) throw new LeadDiscoveryError(candidateCountError.message, "RUN_RETRY_CHECK_FAILED", 500);
    if ((count || 0) > 0) return { duplicate: true, run: existing, candidates: [] };
    const { data: claimed, error: claimError } = await input.db.from("lead_discovery_runs").update({
      status: "running",
      error_message: null,
      summary: {},
      started_at: new Date().toISOString(),
      finished_at: null,
    }).eq("id", existing.id).eq("status", "failed").select("*").maybeSingle();
    if (claimError) throw new LeadDiscoveryError(claimError.message, "RUN_RETRY_FAILED", 500);
    if (!claimed) return { duplicate: true, run: existing, candidates: [] };
    retryRun = claimed;
  }

  const [{ rule, icp }, governance] = await Promise.all([
    loadIcp(input.db),
    loadLeadDiscoveryGovernance(input.db, config),
  ]);
  const querySnapshot = {
    country: icp.country,
    minimumCompanySize: icp.minimumCompanySize,
    maximumCompanySize: icp.maximumCompanySize,
    decisionMakerRoleCount: icp.decisionMakerRoles.length,
    championRoleCount: icp.championRoles.length,
    excludedIndustryCount: icp.excludedIndustries.length,
    ruleVersion: icp.ruleVersion,
    maximumCandidatesPerDay: config.maximumCandidatesPerDay,
  };
  const configurationSnapshot = {
    ...publicLeadDiscoveryConfig(config),
    effectiveDryRun,
    sourceId: governance.source.id,
    campaignId: governance.campaign?.id || null,
  };
  const runResult = retryRun
    ? await input.db.from("lead_discovery_runs").update({
      dry_run: effectiveDryRun,
      source_id: governance.source.id,
      campaign_id: governance.campaign?.id || null,
      business_rule_set_id: rule.id,
      query_snapshot: querySnapshot,
      configuration_snapshot: configurationSnapshot,
      triggered_by: input.actor,
    }).eq("id", retryRun.id).select("*").single()
    : await input.db.from("lead_discovery_runs").insert({
      idempotency_key: input.idempotencyKey,
      provider: config.provider,
      status: "running",
      dry_run: effectiveDryRun,
      source_id: governance.source.id,
      campaign_id: governance.campaign?.id || null,
      business_rule_set_id: rule.id,
      query_snapshot: querySnapshot,
      configuration_snapshot: configurationSnapshot,
      triggered_by: input.actor,
    }).select("*").single();
  const run = runResult.data;
  const runError = runResult.error;
  if (runError || !run) {
    if (runError?.code === "23505") return { duplicate: true, run: null, candidates: [] };
    throw new LeadDiscoveryError(runError?.message || "Run discovery gagal dicatat.", "RUN_CREATE_FAILED", 500);
  }

  try {
    const dayWindow = jakartaDayWindow();
    const { data: todayRuns, error: dailyUsageError } = await input.db.from("lead_discovery_runs")
      .select("id,status,discovered_count,configuration_snapshot")
      .gte("started_at", dayWindow.start)
      .lt("started_at", dayWindow.end)
      .neq("id", run.id)
      .in("status", ["running", "succeeded", "partial"]);
    if (dailyUsageError) throw dailyUsageError;
    const usedToday = (todayRuns || []).reduce((total, item) => {
      if (item.status === "running") {
        return total + integer(record(item.configuration_snapshot).maximumCandidatesPerRun, config.maximumCandidatesPerRun);
      }
      return total + integer(item.discovered_count, 0);
    }, 0);
    const remainingToday = Math.max(0, config.maximumCandidatesPerDay - usedToday);
    if (remainingToday === 0) {
      const summary = { dailyLimitReached: true, date: dayWindow.date, usedToday, maximumCandidatesPerDay: config.maximumCandidatesPerDay, outboundTriggered: false };
      const { data: deferredRun, error: deferredError } = await input.db.from("lead_discovery_runs").update({
        status: "deferred",
        summary,
        finished_at: new Date().toISOString(),
      }).eq("id", run.id).select("*").single();
      if (deferredError) throw deferredError;
      return { duplicate: false, run: deferredRun, candidates: [], summary };
    }
    const effectiveConfig = { ...config, maximumCandidatesPerRun: Math.min(config.maximumCandidatesPerRun, remainingToday) };
    const discovered = await searchLeadDiscoveryCandidates(effectiveConfig, icp, input.fetchImplementation);
    let enrichedCount = 0;
    const states: CandidateState[] = [];
    for (const discoveredCandidate of discovered) {
      const initial = scoreLeadDiscoveryCandidate(discoveredCandidate, icp, config.minimumFitScore);
      let candidate = discoveredCandidate;
      const hunterEnrichmentAllowed = config.provider === "hunter"
        && enrichedCount < config.maximumHunterEnrichmentsPerRun;
      const shouldEnrich = config.enrichWorkEmails
        && (config.provider === "hunter" ? hunterEnrichmentAllowed : initial.eligible);
      if (shouldEnrich) {
        candidate = await enrichLeadDiscoveryCandidate(discoveredCandidate, config, icp, input.fetchImplementation);
        enrichedCount += 1;
      }
      const scored = scoreLeadDiscoveryCandidate(candidate, icp, config.minimumFitScore);
      let fitScore = scored.score;
      let aiScoreAdjustment = 0;
      let aiReasoning: string | null = null;
      if (scored.eligible && config.aiScoringEnabled) {
        try {
          const review = await refineLeadDiscoveryScoreWithAI({
            roleTitle: candidate.roleTitle,
            company: candidate.company,
            industry: candidate.industry,
            location: candidate.location,
            employeeCount: candidate.employeeCount,
            organizationDescription: candidate.organizationDescription,
            deterministicScore: scored.score,
            evidence: scored.evidence,
          });
          aiScoreAdjustment = review.adjustment;
          aiReasoning = review.reasoning;
          fitScore = Math.max(0, Math.min(100, scored.score + review.adjustment));
        } catch (error) {
          aiReasoning = `Penilaian deterministik dipertahankan: ${sanitizeError(error)}`;
        }
      }
      const workEmailAllowed = candidate.emailStatus?.trim().toLowerCase() === "verified"
        && isAllowedWorkEmail(candidate.workEmail, candidate.companyDomain);
      const eligible = scored.eligible && fitScore >= config.minimumFitScore;
      const companyOnly = candidate.candidateKind === "company";
      states.push({
        candidate: { ...candidate, workEmail: workEmailAllowed ? candidate.workEmail?.toLowerCase() || null : null },
        fitScore,
        confidence: scored.confidence,
        status: companyOnly ? "company_review" : !eligible ? "excluded" : workEmailAllowed ? "eligible" : "no_work_email",
        matchReasons: scored.matchReasons,
        exclusionReasons: companyOnly
          ? [...scored.exclusionReasons, "Perusahaan ditemukan; decision maker perlu dipilih atau diperkaya sebelum dapat di-stage."]
          : workEmailAllowed ? scored.exclusionReasons : [...scored.exclusionReasons, "Email kerja terverifikasi belum tersedia."],
        evidence: scored.evidence,
        aiReasoning,
        aiScoreAdjustment,
      });
    }

    const controlledStates = await applyExistingRecordControls(input.db, states, config.provider);
    const { data: savedCandidates, error: candidateError } = await input.db.from("lead_discovery_candidates")
      .insert(controlledStates.map((state) => candidateRow(run.id, state, config.provider))).select("*");
    if (candidateError) throw candidateError;

    const eligibleStates = controlledStates.filter((state) => state.status === "eligible" && state.candidate.workEmail);
    let batchId: string | null = null;
    let stagedCount = 0;
    if (!effectiveDryRun && eligibleStates.length) {
      const { data: staged, error: stageError } = await input.db.rpc("stage_acquisition_batch", {
        p_source_id: governance.source.id,
        p_campaign_id: governance.campaign?.id || null,
        p_import_key: `lead-agent:${config.provider}:${run.id}`,
        p_file_name: `AI Lead Discovery ${new Date().toISOString().slice(0, 10)}`,
        p_file_checksum: null,
        p_prospects: eligibleStates.map((state) => stagingProspect(state, config.provider)),
        p_actor: input.actor,
      });
      if (stageError) throw stageError;
      const stageResult = record(staged);
      batchId = typeof stageResult.batchId === "string" ? stageResult.batchId : null;
      stagedCount = integer(stageResult.validRows, 0);
      if (batchId) {
        const { data: stagedProspects, error: stagedProspectError } = await input.db.from("acquisition_prospects")
          .select("id,external_id,validation_status")
          .eq("batch_id", batchId);
        if (stagedProspectError) throw stagedProspectError;
        const validationStatusMap: Record<string, CandidateState["status"]> = {
          valid: "staged",
          duplicate: "duplicate",
          suppressed: "suppressed",
          excluded: "excluded",
          invalid: "excluded",
          pending: "excluded",
        };
        for (const prospect of stagedProspects || []) {
          const providerPersonId = String(prospect.external_id || "").replace(new RegExp(`^${config.provider}:`), "");
          if (!providerPersonId) continue;
          const updateResult = await input.db.from("lead_discovery_candidates").update({
            status: validationStatusMap[prospect.validation_status] || "excluded",
            acquisition_batch_id: batchId,
            acquisition_prospect_id: prospect.id,
          }).eq("discovery_run_id", run.id).eq("provider_person_id", providerPersonId);
          if (updateResult.error) throw updateResult.error;
        }
      }
    }

    const counts = {
      discoveredCount: discovered.length,
      enrichedCount,
      eligibleCount: eligibleStates.length,
      stagedCount,
      duplicateCount: controlledStates.filter((state) => state.status === "duplicate").length,
      suppressedCount: controlledStates.filter((state) => state.status === "suppressed").length,
      noWorkEmailCount: controlledStates.filter((state) => state.status === "no_work_email").length,
      companyReviewCount: controlledStates.filter((state) => state.status === "company_review").length,
    };
    const summary = {
      ...counts,
      excludedCount: controlledStates.filter((state) => state.status === "excluded").length,
      humanReviewRequired: stagedCount > 0,
      outboundTriggered: false,
      sourceName: governance.source.name,
      campaignName: governance.campaign?.name || null,
      usedBeforeRun: usedToday,
      maximumCandidatesPerDay: config.maximumCandidatesPerDay,
    };
    const { data: completedRun, error: completionError } = await input.db.from("lead_discovery_runs").update({
      status: "succeeded",
      discovered_count: counts.discoveredCount,
      enriched_count: counts.enrichedCount,
      eligible_count: counts.eligibleCount,
      staged_count: counts.stagedCount,
      duplicate_count: counts.duplicateCount,
      suppressed_count: counts.suppressedCount,
      no_work_email_count: counts.noWorkEmailCount,
      company_review_count: counts.companyReviewCount,
      batch_id: batchId,
      summary,
      finished_at: new Date().toISOString(),
    }).eq("id", run.id).select("*").single();
    if (completionError) throw completionError;
    return { duplicate: false, run: completedRun, candidates: savedCandidates || [], summary };
  } catch (error) {
    const safeMessage = sanitizeError(error);
    await input.db.from("lead_discovery_runs").update({
      status: "failed",
      error_message: safeMessage,
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    throw new LeadDiscoveryError(safeMessage, "LEAD_DISCOVERY_FAILED", 502);
  }
}

export const leadDiscoveryServiceInternals = { parseIcp, sanitizeError, jakartaDayWindow };
