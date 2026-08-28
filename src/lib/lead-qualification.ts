export type LeadTemperature = "cold" | "warm" | "hot";

export type LeadQualificationInput = {
  assessmentCompleted: boolean;
  employees?: string | number | null;
  role?: string | null;
  challenge?: string | null;
  target?: string | null;
  industry?: string | null;
  location?: string | null;
  timelineKnown?: boolean;
  sponsorKnown?: boolean;
  budgetKnown?: boolean;
  meetingIntent?: boolean;
  businessConsequenceKnown?: boolean;
};

export type LeadQualificationResult = {
  ruleVersion: string;
  score: number;
  temperature: LeadTemperature;
  confidence: number;
  eligible: boolean;
  buyingSignalCount: number;
  indicators: {
    assessmentCompleted: boolean;
    problemClear: boolean;
    outcomeClear: boolean;
    companySize: "eligible" | "below_minimum" | "unknown";
    roleLevel: "decision_maker" | "champion" | "other" | "unknown";
    timelineKnown: boolean;
    sponsorKnown: boolean;
    budgetKnown: boolean;
    meetingIntent: boolean;
    businessConsequenceKnown: boolean;
  };
  exclusionReasons: string[];
  missingData: string[];
  reasoning: string;
};

export const CONFIRMED_LEAD_RULE_VERSION = "v1.0-confirmed-partial";
export const LEAD_TEMPERATURE_THRESHOLDS = { hot: 75, warm: 50 } as const;
export const MINIMUM_COMPANY_SIZE = 20;
export const MINIMUM_BUYING_SIGNALS = 3;

const DECISION_MAKER_PATTERNS = [
  /\bceo\b/,
  /\bowner\b/,
  /\bdirector\b/,
  /\bdirektur\b/,
  /\bvice president\b/,
  /\bvp\b/,
  /\bsenior manager\b/,
  /\bhead\b/,
  /\bchro\b/,
  /\bcpo\b/,
  /\bchief human resources officer\b/,
  /\bchief people officer\b/,
];

const CHAMPION_PATTERNS = [
  /\bhrbp\b/,
  /\bmanager\b/,
  /\bproject coordinator\b/,
  /\bkoordinator proyek\b/,
  /\bcorporate academy\b/,
  /\blearning academy\b/,
  /\bstrategic office\b/,
];

const EXCLUDED_INDUSTRY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(rokok|tobacco|tembakau)\b/, reason: "Industri rokok/tembakau termasuk exclusion list." },
  { pattern: /\b(minuman keras|alcohol|alcoholic beverage)\b/, reason: "Industri minuman beralkohol termasuk exclusion list." },
  { pattern: /\b(asuransi non[- ]?bpjs|non[- ]?bpjs insurance)\b/, reason: "Asuransi non-BPJS termasuk exclusion list." },
  { pattern: /\b(bank konvensional|conventional bank(?:ing)?)\b/, reason: "Perbankan konvensional termasuk exclusion list." },
  { pattern: /\b(pinjol|pinjaman online|online lending|payday loan)\b/, reason: "Pinjaman online termasuk exclusion list." },
];

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
}

function isClearText(value: unknown, minimumLength = 20) {
  return typeof value === "string" && value.trim().length >= minimumLength;
}

function classifyRole(value: unknown): LeadQualificationResult["indicators"]["roleLevel"] {
  const role = normalized(value);
  if (!role) return "unknown";
  if (DECISION_MAKER_PATTERNS.some((pattern) => pattern.test(role))) return "decision_maker";
  if (CHAMPION_PATTERNS.some((pattern) => pattern.test(role))) return "champion";
  return "other";
}

function classifyCompanySize(value: unknown): LeadQualificationResult["indicators"]["companySize"] {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value >= MINIMUM_COMPANY_SIZE ? "eligible" : "below_minimum";
  }
  const text = normalized(value);
  if (!text) return "unknown";
  const values = text.match(/\d[\d.,]*/g)?.map((entry) => Number(entry.replace(/[.,]/g, ""))) || [];
  const counts = values.filter((entry) => Number.isFinite(entry));
  if (counts.length === 0) return "unknown";
  if (/\+|lebih dari|di atas|above|over/.test(text)) {
    return counts[0] >= MINIMUM_COMPANY_SIZE ? "eligible" : "unknown";
  }
  if (counts.length >= 2) {
    const lower = Math.min(counts[0], counts[1]);
    const upper = Math.max(counts[0], counts[1]);
    if (lower >= MINIMUM_COMPANY_SIZE) return "eligible";
    if (upper < MINIMUM_COMPANY_SIZE) return "below_minimum";
    return "unknown";
  }
  return counts[0] >= MINIMUM_COMPANY_SIZE ? "eligible" : "below_minimum";
}

function roundConfidence(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
}

export function qualifyLead(input: LeadQualificationInput): LeadQualificationResult {
  const problemClear = isClearText(input.challenge);
  const outcomeClear = isClearText(input.target);
  const companySize = classifyCompanySize(input.employees);
  const roleLevel = classifyRole(input.role);
  const sponsorKnown = input.sponsorKnown === true || roleLevel === "decision_maker";
  const timelineKnown = input.timelineKnown === true;
  const budgetKnown = input.budgetKnown === true;
  const meetingIntent = input.meetingIntent === true;
  const businessConsequenceKnown = input.businessConsequenceKnown === true;

  const buyingSignals = [
    problemClear,
    timelineKnown,
    sponsorKnown,
    budgetKnown,
    meetingIntent,
    businessConsequenceKnown,
  ];
  const buyingSignalCount = buyingSignals.filter(Boolean).length;

  let score = 0;
  if (input.assessmentCompleted) score += 15;
  if (problemClear) score += 20;
  if (outcomeClear) score += 10;
  if (companySize === "eligible") score += 10;
  if (roleLevel === "decision_maker") score += 15;
  else if (roleLevel === "champion") score += 8;
  if (timelineKnown) score += 15;
  if (budgetKnown) score += 10;
  if (meetingIntent) score += 10;
  if (businessConsequenceKnown) score += 5;
  score = Math.min(100, score);

  const industry = normalized(input.industry);
  const exclusionReasons = EXCLUDED_INDUSTRY_PATTERNS
    .filter(({ pattern }) => pattern.test(industry))
    .map(({ reason }) => reason);
  if (companySize === "below_minimum") {
    exclusionReasons.push(`Ukuran perusahaan terkonfirmasi di bawah ${MINIMUM_COMPANY_SIZE} orang.`);
  }
  const eligible = exclusionReasons.length === 0;

  const hotRequirementsMet = problemClear && timelineKnown && sponsorKnown && meetingIntent;
  const temperature: LeadTemperature = !eligible
    ? "cold"
    : score >= LEAD_TEMPERATURE_THRESHOLDS.hot
      && buyingSignalCount >= MINIMUM_BUYING_SIGNALS
      && hotRequirementsMet
      ? "hot"
      : score >= LEAD_TEMPERATURE_THRESHOLDS.warm
        ? "warm"
        : "cold";

  const knownData = [
    Boolean(normalized(input.employees)),
    Boolean(normalized(input.role)),
    Boolean(normalized(input.challenge)),
    Boolean(normalized(input.target)),
    Boolean(industry),
    Boolean(normalized(input.location)),
    input.timelineKnown !== undefined,
    input.budgetKnown !== undefined,
    input.meetingIntent !== undefined,
    input.businessConsequenceKnown !== undefined,
  ];
  const confidence = roundConfidence(knownData.filter(Boolean).length / knownData.length);

  const missingData: string[] = [];
  if (!normalized(input.industry)) missingData.push("industry");
  if (!normalized(input.location)) missingData.push("location");
  if (companySize === "unknown") missingData.push("companySizeConfirmation");
  if (roleLevel === "unknown" || roleLevel === "other") missingData.push("decisionMakerOrChampion");
  if (!problemClear) missingData.push("problemOrNeed");
  if (!outcomeClear) missingData.push("objectiveOrExpectedOutcome");
  if (input.timelineKnown === undefined || !timelineKnown) missingData.push("timeline");
  if (input.budgetKnown === undefined || !budgetKnown) missingData.push("budget");
  if (input.meetingIntent === undefined || !meetingIntent) missingData.push("nextStepOrMeeting");
  if (input.businessConsequenceKnown === undefined || !businessConsequenceKnown) missingData.push("businessConsequence");

  const reasoning = exclusionReasons.length > 0
    ? `Lead ditahan karena ${exclusionReasons.join(" ")}`
    : temperature === "hot"
      ? `Lead memenuhi threshold Hot, memiliki ${buyingSignalCount} buying signals, dan seluruh syarat wajib Hot.`
      : temperature === "warm"
        ? `Lead memenuhi threshold Warm, tetapi data Hot belum lengkap (${missingData.join(", ") || "tidak ada"}).`
        : `Data dan buying signals belum cukup untuk melewati threshold Warm (${score}/100).`;

  return {
    ruleVersion: CONFIRMED_LEAD_RULE_VERSION,
    score,
    temperature,
    confidence,
    eligible,
    buyingSignalCount,
    indicators: {
      assessmentCompleted: input.assessmentCompleted,
      problemClear,
      outcomeClear,
      companySize,
      roleLevel,
      timelineKnown,
      sponsorKnown,
      budgetKnown,
      meetingIntent,
      businessConsequenceKnown,
    },
    exclusionReasons,
    missingData: [...new Set(missingData)],
    reasoning,
  };
}
