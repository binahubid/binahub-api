export type LeadDiscoveryProvider = "apollo" | "hunter";

export type LeadDiscoveryConfig = {
  provider: LeadDiscoveryProvider;
  enabled: boolean;
  providerCallsEnabled: boolean;
  dryRun: boolean;
  stagingEnabled: boolean;
  aiScoringEnabled: boolean;
  enrichWorkEmails: boolean;
  hunterAiQueryEnabled: boolean;
  maximumHunterEnrichmentsPerRun: number;
  apiKeyConfigured: boolean;
  sourceId: string | null;
  sourceKey: string | null;
  campaignId: string | null;
  campaignCode: string | null;
  maximumCandidatesPerRun: number;
  maximumCandidatesPerDay: number;
  minimumFitScore: number;
  requestTimeoutMs: number;
  blockers: string[];
};

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function optionalUuid(value: string | undefined) {
  const normalized = value?.trim() || "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function optionalReference(value: string | undefined) {
  const normalized = value?.trim() || "";
  return /^[a-zA-Z0-9][a-zA-Z0-9_\-]{2,79}$/.test(normalized) ? normalized : null;
}

export function getLeadDiscoveryConfig(environment: Record<string, string | undefined> = process.env): LeadDiscoveryConfig {
  const providerValue = (environment.LEAD_AGENT_PROVIDER || "apollo").trim().toLowerCase();
  const provider: LeadDiscoveryProvider = providerValue === "hunter" ? "hunter" : "apollo";
  const isEnabled = enabled(environment.LEAD_AGENT_ENABLED);
  const providerCallsEnabled = enabled(environment.LEAD_AGENT_PROVIDER_CALLS_ENABLED);
  const dryRun = environment.LEAD_AGENT_DRY_RUN?.trim().toLowerCase() !== "false";
  const stagingEnabled = enabled(environment.LEAD_AGENT_STAGING_ENABLED);
  const aiScoringEnabled = enabled(environment.LEAD_AGENT_AI_SCORING_ENABLED);
  const apiKeyConfigured = provider === "hunter"
    ? Boolean(environment.HUNTER_API_KEY?.trim())
    : Boolean(environment.APOLLO_API_KEY?.trim());
  const sourceId = optionalUuid(environment.LEAD_AGENT_SOURCE_ID);
  const sourceKey = optionalReference(environment.LEAD_AGENT_SOURCE_KEY)?.toLowerCase() || null;
  const campaignId = optionalUuid(environment.LEAD_AGENT_CAMPAIGN_ID);
  const campaignCode = optionalReference(environment.LEAD_AGENT_CAMPAIGN_CODE)?.toUpperCase() || null;
  const blockers: string[] = [];

  if (!(["apollo", "hunter"] as string[]).includes(providerValue)) blockers.push("Penyedia discovery belum didukung.");
  if (!isEnabled) blockers.push("AI Lead Agent belum diaktifkan.");
  if (!providerCallsEnabled) blockers.push("Panggilan ke penyedia discovery masih dikunci.");
  if (!apiKeyConfigured) blockers.push("Kredensial penyedia discovery belum tersedia.");
  if (!sourceId && !sourceKey) blockers.push("Sumber data berizin untuk discovery belum dipilih.");
  if (!dryRun && stagingEnabled && !campaignId && !campaignCode) blockers.push("Kampanye untuk staging belum dipilih.");
  if (aiScoringEnabled
    && !environment.CODECRAFT_API_KEY?.trim()
    && !environment.OPENROUTER_API_KEY?.trim()) {
    blockers.push("Kredensial AI scoring belum tersedia.");
  }

  return {
    provider,
    enabled: isEnabled,
    providerCallsEnabled,
    dryRun,
    stagingEnabled,
    aiScoringEnabled,
    enrichWorkEmails: provider === "hunter"
      ? enabled(environment.LEAD_AGENT_HUNTER_ENRICH_WORK_EMAILS)
      : enabled(environment.LEAD_AGENT_APOLLO_ENRICH_WORK_EMAILS),
    hunterAiQueryEnabled: provider === "hunter" && enabled(environment.LEAD_AGENT_HUNTER_AI_QUERY_ENABLED),
    maximumHunterEnrichmentsPerRun: boundedInteger(environment.LEAD_AGENT_HUNTER_MAX_DOMAIN_SEARCHES_PER_RUN, 3, 0, 10),
    apiKeyConfigured,
    sourceId,
    sourceKey,
    campaignId,
    campaignCode,
    maximumCandidatesPerRun: boundedInteger(environment.LEAD_AGENT_MAX_CANDIDATES_PER_RUN, 10, 1, 100),
    maximumCandidatesPerDay: boundedInteger(environment.LEAD_AGENT_MAX_CANDIDATES_PER_DAY, 25, 1, 500),
    minimumFitScore: boundedInteger(environment.LEAD_AGENT_MIN_SCORE, 50, 0, 100),
    requestTimeoutMs: boundedInteger(environment.LEAD_AGENT_REQUEST_TIMEOUT_MS, 20_000, 5_000, 60_000),
    blockers,
  };
}

export function publicLeadDiscoveryConfig(config: LeadDiscoveryConfig) {
  return {
    provider: config.provider,
    availableProviders: [
      { key: "hunter", mode: "api", plan: "free", executable: true },
      { key: "apollo", mode: "api", plan: "paid_api", executable: true },
      { key: "manual", mode: "manual_upload", plan: "free", executable: false },
    ],
    enabled: config.enabled,
    providerCallsEnabled: config.providerCallsEnabled,
    dryRun: config.dryRun,
    stagingEnabled: config.stagingEnabled,
    aiScoringEnabled: config.aiScoringEnabled,
    enrichWorkEmails: config.enrichWorkEmails,
    hunterAiQueryEnabled: config.hunterAiQueryEnabled,
    maximumHunterEnrichmentsPerRun: config.maximumHunterEnrichmentsPerRun,
    apiKeyConfigured: config.apiKeyConfigured,
    sourceConfigured: Boolean(config.sourceId || config.sourceKey),
    campaignConfigured: Boolean(config.campaignId || config.campaignCode),
    maximumCandidatesPerRun: config.maximumCandidatesPerRun,
    maximumCandidatesPerDay: config.maximumCandidatesPerDay,
    minimumFitScore: config.minimumFitScore,
    blockers: config.blockers,
  };
}
