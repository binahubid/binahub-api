import { createHmac, randomUUID } from "node:crypto";

function configuration() {
  const baseUrl = process.env.AMS_API_URL?.replace(/\/$/, "");
  const secret = process.env.AMS_INTEGRATION_SECRET;
  if (!baseUrl || !secret) throw new Error("Integrasi AMS belum dikonfigurasi.");
  return { baseUrl, secret };
}

export async function callAms<T>(path: string, payload: unknown): Promise<T> {
  const { baseUrl, secret } = configuration();
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-binahub-timestamp": timestamp,
      "x-binahub-signature": signature,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error || "AMS tidak dapat dihubungi.");
  return result as T;
}

export function createAssignmentRequestId() {
  return randomUUID();
}
