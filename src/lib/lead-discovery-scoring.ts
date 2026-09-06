export type LeadDiscoveryIcp = {
  industries: string[];
  excludedIndustries: string[];
  minimumCompanySize: number;
  maximumCompanySize: number | null;
  country: string;
  priorityLocations: string[];
  decisionMakerRoles: string[];
  championRoles: string[];
  positiveSignals: string[];
  otherExclusions: string[];
  ruleVersion: string;
};

export type DiscoveryCandidate = {
  candidateKind: "company" | "person";
  providerPersonId: string;
  providerOrganizationId: string | null;
  fullName: string;
  roleTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  industry: string | null;
  location: string | null;
  employeeCount: number | null;
  employeeRange: string | null;
  workEmail: string | null;
  emailStatus: string | null;
  linkedinUrl: string | null;
  sourceUrl: string | null;
  organizationDescription: string | null;
  organizationKeywords: string[];
};

export type LeadDiscoveryScore = {
  score: number;
  confidence: number;
  eligible: boolean;
  matchReasons: string[];
  exclusionReasons: string[];
  evidence: Record<string, unknown>;
};

const personalEmailDomains = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.id", "outlook.com", "hotmail.com",
  "icloud.com", "me.com", "live.com", "aol.com", "proton.me", "protonmail.com",
]);

function normalize(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replaceAll(/[_/\-]+/g, " ");
}

function containsAny(value: string, options: string[]) {
  const normalizedValue = normalize(value);
  return options.some((option) => {
    if (normalize(option).startsWith("other role")) return false;
    return option.split("/")
      .map(normalize)
      .some((alternative) => alternative.length >= 2 && normalizedValue.includes(alternative));
  });
}

function parseEmployeeRange(value: string | null | undefined) {
  const normalized = (value || "").replaceAll(",", "").trim();
  const bounded = normalized.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (bounded) return { minimum: Number(bounded[1]), maximum: Number(bounded[2]) };
  const open = normalized.match(/^(\d+)\+$/);
  if (open) return { minimum: Number(open[1]), maximum: null };
  const exact = normalized.match(/^\d+$/);
  if (exact) return { minimum: Number(normalized), maximum: Number(normalized) };
  return null;
}

export function isAllowedWorkEmail(email: string | null | undefined, companyDomain?: string | null) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return false;
  const domain = normalizedEmail.split("@")[1];
  if (!domain || personalEmailDomains.has(domain)) return false;
  const normalizedCompanyDomain = (companyDomain || "").trim().toLowerCase().replace(/^www\./, "");
  return Boolean(normalizedCompanyDomain) && (domain === normalizedCompanyDomain || domain.endsWith(`.${normalizedCompanyDomain}`));
}

export function scoreLeadDiscoveryCandidate(
  candidate: DiscoveryCandidate,
  icp: LeadDiscoveryIcp,
  minimumScore: number,
): LeadDiscoveryScore {
  let score = 0;
  let evaluatedSignals = 0;
  const matchReasons: string[] = [];
  const exclusionReasons: string[] = [];
  const title = normalize(candidate.roleTitle);
  const industry = normalize(candidate.industry);
  const location = normalize(candidate.location);
  const locationParts = location.split(",").map((item) => item.trim());
  const companyText = normalize([
    candidate.company,
    candidate.industry,
    candidate.organizationDescription,
    ...candidate.organizationKeywords,
  ].filter(Boolean).join(" "));
  const decisionMakerMatch = containsAny(title, icp.decisionMakerRoles);
  const championMatch = containsAny(title, icp.championRoles);
  const roleMatch = decisionMakerMatch || championMatch;
  const employeeRange = parseEmployeeRange(candidate.employeeRange);
  const companySizeMatch = candidate.employeeCount !== null
    ? candidate.employeeCount >= icp.minimumCompanySize
      && (icp.maximumCompanySize === null || candidate.employeeCount <= icp.maximumCompanySize)
    : Boolean(employeeRange
      && employeeRange.minimum >= icp.minimumCompanySize
      && (icp.maximumCompanySize === null || (employeeRange.maximum !== null && employeeRange.maximum <= icp.maximumCompanySize)));
  const locationMatch = Boolean(location) && (
    location.includes(normalize(icp.country))
    || (normalize(icp.country) === "indonesia" && locationParts.includes("id"))
    || icp.priorityLocations.some((item) => location.includes(normalize(item)))
  );
  const industryExcluded = Boolean(industry) && icp.excludedIndustries.some((item) => industry.includes(normalize(item)));

  if (title) evaluatedSignals += 1;
  if (decisionMakerMatch) {
    score += 35;
    matchReasons.push("Jabatan sesuai decision maker ICP.");
  } else if (championMatch) {
    score += 25;
    matchReasons.push("Jabatan sesuai internal champion ICP.");
  } else {
    exclusionReasons.push("Jabatan belum sesuai decision maker atau champion ICP.");
  }

  if (candidate.employeeCount !== null || employeeRange) {
    evaluatedSignals += 1;
    if (companySizeMatch) {
      score += 20;
      matchReasons.push("Ukuran perusahaan sesuai ICP.");
    } else {
      exclusionReasons.push("Ukuran perusahaan di luar ICP.");
    }
  } else exclusionReasons.push("Ukuran perusahaan belum dapat diverifikasi.");

  if (location) evaluatedSignals += 1;
  if (locationMatch) {
    score += 15;
    matchReasons.push("Lokasi sesuai target Indonesia.");
  } else {
    exclusionReasons.push("Lokasi tidak terverifikasi sesuai target Indonesia.");
  }

  if (industry) evaluatedSignals += 1;
  if (!industry) {
    exclusionReasons.push("Industri belum tersedia.");
  } else if (industryExcluded) {
    exclusionReasons.push("Industri termasuk kriteria pengecualian.");
  } else if (icp.industries.length === 0 || icp.industries.includes("general") || containsAny(industry, icp.industries)) {
    score += 15;
    matchReasons.push("Industri tidak termasuk pengecualian ICP.");
  }

  if (companyText) evaluatedSignals += 1;
  const positiveSignals = icp.positiveSignals.filter((signal) => companyText.includes(normalize(signal)));
  if (positiveSignals.length) {
    score += Math.min(15, positiveSignals.length * 5);
    matchReasons.push(`Sinyal kebutuhan terdeteksi: ${positiveSignals.slice(0, 3).join(", ")}.`);
  }

  const hardExcluded = !roleMatch || !companySizeMatch || !locationMatch || !industry || industryExcluded;
  const boundedScore = Math.max(0, Math.min(100, score));

  return {
    score: boundedScore,
    confidence: Number(Math.min(1, evaluatedSignals / 5).toFixed(3)),
    eligible: !hardExcluded && boundedScore >= minimumScore,
    matchReasons,
    exclusionReasons,
    evidence: {
      roleTitle: candidate.roleTitle,
      employeeCount: candidate.employeeCount,
      employeeRange: candidate.employeeRange,
      industry: candidate.industry,
      location: candidate.location,
      positiveSignals,
      ruleVersion: icp.ruleVersion,
    },
  };
}
