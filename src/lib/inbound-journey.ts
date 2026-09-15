export type InboundAttribution = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  gclid?: string;
  fbclid?: string;
  msclkid?: string;
  landingPage?: string;
  referrer?: string;
};

export type ClassifiedChannel = "direct" | "organic" | "paid_search" | "paid_social" | "social" | "referral" | "email" | "other";

const SOCIAL_SOURCES = new Set(["facebook", "fb", "instagram", "ig", "linkedin", "tiktok", "x", "twitter", "youtube"]);
const SEARCH_SOURCES = new Set(["google", "bing", "yahoo", "duckduckgo"]);

function lower(value?: string) {
  return value?.trim().toLocaleLowerCase("en-US") || "";
}

function referrerHost(value?: string) {
  if (!value) return "";
  try { return new URL(value).hostname.toLocaleLowerCase("en-US").replace(/^www\./, ""); }
  catch { return ""; }
}

/**
 * Normalizes channels deterministically. We intentionally do not infer an
 * advertising channel from an opaque referrer alone; unknown values remain
 * referral/other instead of being falsely reported as paid traffic.
 */
export function classifyInboundAttribution(input: InboundAttribution): ClassifiedChannel {
  const source = lower(input.utmSource);
  const medium = lower(input.utmMedium);
  const referrer = referrerHost(input.referrer);
  const hasPaidClickId = Boolean(input.gclid || input.fbclid || input.msclkid);

  if (!source && !medium && !referrer && !hasPaidClickId) return "direct";
  if (medium === "email" || medium === "newsletter") return "email";
  if (hasPaidClickId || medium === "cpc" || medium === "ppc" || medium === "paid_social" || medium === "paid-social") {
    return SOCIAL_SOURCES.has(source) || Boolean(input.fbclid) || medium.includes("social") ? "paid_social" : "paid_search";
  }
  if (SOCIAL_SOURCES.has(source) || /(^|\.)(facebook|instagram|linkedin|tiktok|twitter|x|youtube)\./.test(referrer)) return "social";
  if (SEARCH_SOURCES.has(source) || /(^|\.)(google|bing|yahoo|duckduckgo)\./.test(referrer)) return "organic";
  if (source || medium || referrer) return "referral";
  return "other";
}

export function compactInboundAttribution(input: InboundAttribution) {
  const entries = Object.entries(input)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => [key, value.trim()] as const);
  return Object.fromEntries(entries) as InboundAttribution;
}
