export function safeTelemetryText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try { const url = new URL(raw); return `${url.origin}${url.pathname}`; }
      catch { return "[redacted-url]"; }
    })
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\b(?:sk-|sk_|cc_|re_)[A-Za-z0-9_-]{16,}/g, "[redacted-key]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

export function safeTelemetryRoute(value: string): string {
  try {
    const pathname = new URL(value, "https://app.binahub.id").pathname;
    return safeTelemetryText(pathname)
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]")
      .replace(/\b\d{8,}\b/g, "[id]").slice(0, 300);
  } catch { return "/unknown"; }
}

export type TelemetryPayload = {
  message: string;
  stack?: string;
  route?: string;
  code?: string;
  release?: string;
};
export function sanitizeTelemetry(input: TelemetryPayload): TelemetryPayload {
  return {
    message: safeTelemetryText(input.message).slice(0, 1000),
    stack: safeTelemetryText(input.stack || "").slice(0, 6000),
    route: safeTelemetryRoute(input.route || "/unknown"),
    code: (input.code || "RUNTIME_ERROR").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
    release: (input.release || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 100),
  };
}
