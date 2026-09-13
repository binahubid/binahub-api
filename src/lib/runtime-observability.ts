import { createServerSupabase } from "./supabase";
import { sanitizeTelemetry, type TelemetryPayload } from "./telemetry-privacy";

export async function recordRuntimeError(input: TelemetryPayload, options: {
  trusted?: boolean; synthetic?: boolean;
} = {}) {
  const payload = sanitizeTelemetry({
    ...input, release: input.release || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA,
  });
  const trusted = options.trusted !== false;
  const synthetic = options.synthetic === true;
  const fingerprintBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([
    trusted, synthetic, payload.code, payload.route, payload.message, payload.release,
  ])));
  const fingerprint = Array.from(new Uint8Array(fingerprintBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    const db = createServerSupabase();
    const { data, error } = await db.rpc("record_runtime_error", {
      p_fingerprint: fingerprint, p_trusted: trusted, p_synthetic: synthetic,
      p_message: payload.message, p_stack: payload.stack || "",
      p_route: payload.route || "/unknown", p_code: payload.code || "RUNTIME_ERROR",
      p_release: payload.release || "",
    });
    if (error) throw error;
    return { stored: true, id: String(data) };
  } catch {
    console.error("[Observability] persistent sink unavailable", payload.code);
    return { stored: false, id: null };
  }
}
