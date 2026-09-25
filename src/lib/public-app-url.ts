const PRODUCTION_APP_URL = "https://app.binahub.id";
const LOCAL_HOSTNAMES = new Set(["0.0.0.0", "127.0.0.1", "localhost", "::1", "[::1]"]);

export function resolvePublicAppUrl(candidate = process.env.APP_PUBLIC_URL): string {
  const fallback = PRODUCTION_APP_URL;
  const raw = candidate?.trim();
  if (!raw) return fallback;

  try {
    const url = new URL(raw);
    const localHost = LOCAL_HOSTNAMES.has(url.hostname.toLowerCase());
    const production = process.env.NODE_ENV === "production";
    if (production && (url.protocol !== "https:" || localHost)) return fallback;
    if (!production && !["http:", "https:"].includes(url.protocol)) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
}
