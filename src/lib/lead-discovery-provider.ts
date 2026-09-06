import type { LeadDiscoveryConfig } from "@/lib/lead-discovery-config";
import type { DiscoveryCandidate, LeadDiscoveryIcp } from "@/lib/lead-discovery-scoring";
import { enrichHunterCandidate, searchHunterCandidates } from "./lead-discovery-hunter-provider";

const APOLLO_BASE_URL = "https://api.apollo.io/api/v1";

type JsonObject = Record<string, unknown>;

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function textArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function normalizeApolloPerson(value: unknown): DiscoveryCandidate | null {
  const person = record(value);
  const organization = record(person.organization);
  const providerPersonId = text(person.id);
  const firstName = text(person.first_name);
  const lastName = text(person.last_name);
  const fullName = text(person.name) || [firstName, lastName].filter(Boolean).join(" ");
  if (!providerPersonId || !fullName) return null;
  const organizationLocation = [text(organization.city), text(organization.state), text(organization.country)]
    .filter(Boolean)
    .join(", ");
  const personLocation = [text(person.city), text(person.state), text(person.country)].filter(Boolean).join(", ");
  // ICP lokasi adalah target perusahaan. Lokasi orang hanya menjadi fallback saat
  // provider tidak mengembalikan lokasi organisasi.
  const location = organizationLocation || personLocation || null;

  return {
    candidateKind: "person",
    providerPersonId,
    providerOrganizationId: text(organization.id),
    fullName,
    roleTitle: text(person.title),
    company: text(organization.name),
    companyDomain: text(organization.primary_domain),
    industry: text(organization.industry),
    location,
    employeeCount: number(organization.estimated_num_employees),
    employeeRange: null,
    workEmail: text(person.email)?.toLowerCase() || null,
    emailStatus: text(person.email_status),
    linkedinUrl: text(person.linkedin_url),
    sourceUrl: text(organization.website_url),
    organizationDescription: text(organization.short_description),
    organizationKeywords: textArray(organization.keywords),
  };
}

async function apolloRequest(
  path: string,
  params: URLSearchParams,
  config: LeadDiscoveryConfig,
  fetchImplementation: typeof fetch,
) {
  const apiKey = process.env.APOLLO_API_KEY?.trim();
  if (!apiKey) throw new Error("Kredensial penyedia discovery belum tersedia.");
  const response = await fetchImplementation(`${APOLLO_BASE_URL}${path}?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const providerMessage = text(record(payload).message) || text(record(payload).error) || `HTTP ${response.status}`;
    throw new Error(`Penyedia discovery menolak permintaan: ${providerMessage}`);
  }
  return record(payload);
}

function addAll(params: URLSearchParams, key: string, values: string[], maximum = 20) {
  values.slice(0, maximum).forEach((value) => params.append(key, value));
}

function companySizeRange(icp: LeadDiscoveryIcp) {
  return `${icp.minimumCompanySize},${icp.maximumCompanySize || 1000000}`;
}

export async function searchApolloCandidates(
  config: LeadDiscoveryConfig,
  icp: LeadDiscoveryIcp,
  fetchImplementation: typeof fetch = fetch,
) {
  const params = new URLSearchParams({
    page: "1",
    per_page: String(config.maximumCandidatesPerRun),
  });
  addAll(params, "person_titles[]", [...icp.decisionMakerRoles, ...icp.championRoles].filter((role) => !role.toLowerCase().startsWith("other role")));
  addAll(params, "organization_locations[]", [icp.country]);
  params.append("organization_num_employees_ranges[]", companySizeRange(icp));
  params.append("contact_email_status[]", "verified");
  const payload = await apolloRequest("/mixed_people/api_search", params, config, fetchImplementation);
  const people = Array.isArray(payload.people) ? payload.people : [];
  return people.map(normalizeApolloPerson).filter((item): item is DiscoveryCandidate => Boolean(item));
}

export async function enrichApolloCandidate(
  candidate: DiscoveryCandidate,
  config: LeadDiscoveryConfig,
  fetchImplementation: typeof fetch = fetch,
) {
  if (!config.enrichWorkEmails) return candidate;
  const params = new URLSearchParams({
    id: candidate.providerPersonId,
    reveal_personal_emails: "false",
    reveal_phone_number: "false",
  });
  const payload = await apolloRequest("/people/match", params, config, fetchImplementation);
  const enriched = normalizeApolloPerson(payload.person);
  return enriched ? { ...candidate, ...enriched } : candidate;
}

export async function searchLeadDiscoveryCandidates(
  config: LeadDiscoveryConfig,
  icp: LeadDiscoveryIcp,
  fetchImplementation: typeof fetch = fetch,
) {
  if (config.provider === "hunter") return searchHunterCandidates(config, icp, fetchImplementation);
  return searchApolloCandidates(config, icp, fetchImplementation);
}

export async function enrichLeadDiscoveryCandidate(
  candidate: DiscoveryCandidate,
  config: LeadDiscoveryConfig,
  icp: LeadDiscoveryIcp,
  fetchImplementation: typeof fetch = fetch,
) {
  if (config.provider === "hunter") return enrichHunterCandidate(candidate, config, icp, fetchImplementation);
  return enrichApolloCandidate(candidate, config, fetchImplementation);
}

export const leadDiscoveryProviderInternals = { normalizeApolloPerson };
