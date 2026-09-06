import type { LeadDiscoveryConfig } from "@/lib/lead-discovery-config";
import type { DiscoveryCandidate, LeadDiscoveryIcp } from "@/lib/lead-discovery-scoring";

const HUNTER_BASE_URL = "https://api.hunter.io/v2";

type JsonObject = Record<string, unknown>;
type HeadcountBucket = { value: string; minimum: number; maximum: number | null };

const headcountBuckets: HeadcountBucket[] = [
  { value: "1-10", minimum: 1, maximum: 10 },
  { value: "11-50", minimum: 11, maximum: 50 },
  { value: "51-200", minimum: 51, maximum: 200 },
  { value: "201-500", minimum: 201, maximum: 500 },
  { value: "501-1000", minimum: 501, maximum: 1000 },
  { value: "1001-5000", minimum: 1001, maximum: 5000 },
  { value: "5001-10000", minimum: 5001, maximum: 10000 },
  { value: "10001+", minimum: 10001, maximum: null },
];

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function hunterCountryCode(country: string) {
  const normalized = country.trim().toLowerCase();
  if (normalized === "indonesia") return "ID";
  return /^[a-z]{2}$/i.test(country.trim()) ? country.trim().toUpperCase() : country.trim();
}

function safeHeadcountBuckets(icp: LeadDiscoveryIcp) {
  return headcountBuckets
    .filter((bucket) => bucket.minimum >= icp.minimumCompanySize)
    .filter((bucket) => icp.maximumCompanySize === null
      || (bucket.maximum !== null && bucket.maximum <= icp.maximumCompanySize))
    .map((bucket) => bucket.value);
}

function hunterIcpQuery(icp: LeadDiscoveryIcp) {
  const industries = (icp.industries || []).filter((item) => item.trim().toLowerCase() !== "general").slice(0, 8);
  const signals = (icp.positiveSignals || []).slice(0, 8);
  const parts = [
    industries.length ? `Companies in ${industries.join(", ")}` : "Companies",
    signals.length ? `with business needs or public signals related to ${signals.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length > 1 ? parts.join(" ").replaceAll("_", " ").slice(0, 2000) : null;
}

function errorMessage(payload: JsonObject, fallback: string) {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const details = errors.map((item) => text(record(item).details)).filter(Boolean);
  return details.join(" ") || text(record(payload.error).details) || text(payload.error) || fallback;
}

async function hunterRequest(
  path: string,
  config: LeadDiscoveryConfig,
  fetchImplementation: typeof fetch,
  init: { method: "GET" | "POST"; body?: JsonObject },
) {
  const apiKey = process.env.HUNTER_API_KEY?.trim();
  if (!apiKey) throw new Error("Kredensial Hunter belum tersedia.");
  const response = await fetchImplementation(`${HUNTER_BASE_URL}${path}`, {
    method: init.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const payload = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(`Hunter menolak permintaan: ${errorMessage(payload, `HTTP ${response.status}`)}`);
  return payload;
}

function normalizeHunterCompany(value: unknown): DiscoveryCandidate | null {
  const company = record(value);
  const domain = text(company.domain)?.toLowerCase() || null;
  if (!domain) return null;
  const organization = text(company.organization) || domain;
  const location = [text(company.city), text(company.state), text(company.country)].filter(Boolean).join(", ") || null;
  return {
    candidateKind: "company",
    providerPersonId: `company:${domain}`,
    providerOrganizationId: domain,
    fullName: "Decision maker belum dipilih",
    roleTitle: null,
    company: organization,
    companyDomain: domain,
    industry: text(company.industry),
    location,
    employeeCount: null,
    employeeRange: text(company.headcount),
    workEmail: null,
    emailStatus: null,
    linkedinUrl: null,
    sourceUrl: `https://${domain}`,
    organizationDescription: text(company.description),
    organizationKeywords: textArray(company.keywords),
  };
}

function normalizeRole(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replaceAll(/[_/\-]+/g, " ");
}

function rolePriority(roleTitle: string | null, icp: LeadDiscoveryIcp) {
  const title = normalizeRole(roleTitle);
  const roles = [...icp.decisionMakerRoles, ...icp.championRoles]
    .filter((role) => !normalizeRole(role).startsWith("other role"));
  const index = roles.findIndex((role) => role.split("/").some((item) => title.includes(normalizeRole(item))));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizeHunterEmail(value: unknown, company: DiscoveryCandidate): DiscoveryCandidate | null {
  const email = record(value);
  const firstName = text(email.first_name);
  const lastName = text(email.last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const workEmail = text(email.value)?.toLowerCase() || null;
  const verificationStatus = text(record(email.verification).status)?.toLowerCase() || null;
  if (!fullName || !workEmail) return null;
  return {
    ...company,
    candidateKind: "person",
    providerPersonId: text(email.id) || workEmail,
    fullName,
    roleTitle: text(email.position) || text(email.position_raw),
    workEmail,
    emailStatus: verificationStatus === "valid" ? "verified" : verificationStatus,
    linkedinUrl: text(email.linkedin),
  };
}

export async function searchHunterCandidates(
  config: LeadDiscoveryConfig,
  icp: LeadDiscoveryIcp,
  fetchImplementation: typeof fetch = fetch,
) {
  const headcount = safeHeadcountBuckets(icp);
  if (!headcount.length) return [];
  const body: JsonObject = {
    headquarters_location: { include: [{ country: hunterCountryCode(icp.country) }] },
    headcount,
  };
  const query = config.hunterAiQueryEnabled ? hunterIcpQuery(icp) : null;
  if (query) body.query = query;
  const payload = await hunterRequest("/discover", config, fetchImplementation, { method: "POST", body });
  const companies = Array.isArray(payload.data) ? payload.data : [];
  return companies
    .map(normalizeHunterCompany)
    .filter((item): item is DiscoveryCandidate => Boolean(item))
    .slice(0, config.maximumCandidatesPerRun);
}

export async function enrichHunterCandidate(
  candidate: DiscoveryCandidate,
  config: LeadDiscoveryConfig,
  icp: LeadDiscoveryIcp,
  fetchImplementation: typeof fetch = fetch,
) {
  if (!config.enrichWorkEmails || !candidate.companyDomain) return candidate;
  const params = new URLSearchParams({
    domain: candidate.companyDomain,
    type: "personal",
    limit: "10",
    seniority: "senior,executive",
    decision_maker: "true",
    required_field: "full_name,position",
    verification_status: "valid",
  });
  const payload = await hunterRequest(`/domain-search?${params.toString()}`, config, fetchImplementation, { method: "GET" });
  const emails = Array.isArray(record(payload.data).emails) ? record(payload.data).emails as unknown[] : [];
  const candidates = emails
    .map((email) => normalizeHunterEmail(email, candidate))
    .filter((item): item is DiscoveryCandidate => Boolean(item))
    .sort((left, right) => rolePriority(left.roleTitle, icp) - rolePriority(right.roleTitle, icp));
  return candidates.find((item) => rolePriority(item.roleTitle, icp) !== Number.MAX_SAFE_INTEGER) || candidate;
}

export const leadDiscoveryHunterProviderInternals = {
  normalizeHunterCompany,
  normalizeHunterEmail,
  safeHeadcountBuckets,
  hunterIcpQuery,
};
