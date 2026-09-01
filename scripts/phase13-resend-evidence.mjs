import { createHmac, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_RESEND_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || `phase13-resend-${Date.now()}`;
const failures = [];

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function check(condition, message, detail) {
  if (condition) {
    pass(message);
    return;
  }
  fail(`${message}${detail ? ` — ${detail}` : ""}`);
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Environment ${name} belum tersedia.`);
  return value || "";
}

function signWebhook(secret, id, timestamp, body) {
  const encodedSecret = secret.replace(/^whsec_/, "");
  const key = Buffer.from(encodedSecret, "base64");
  if (!key.length) throw new Error("RESEND_WEBHOOK_SECRET bukan standard webhook secret yang valid.");
  const signature = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${signature}`;
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_RESEND_TEST=true untuk mengizinkan webhook evidence ke production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = requiredEnvironment("RESEND_WEBHOOK_SECRET");
if (failures.length) process.exit(1);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const timestamp = Math.floor(Date.now() / 1000).toString();
const shortId = randomUUID().replace(/-/g, "").slice(0, 16);
const webhookId = `msg_phase13_${shortId}`;
const recipientEmail = `${runLabel.replace(/[^a-z0-9-]/gi, "").slice(0, 40).toLowerCase()}-${shortId.slice(0, 6)}@example.invalid`;
const payload = JSON.stringify({
  type: "email.bounced",
  created_at: new Date().toISOString(),
  data: {
    email_id: `phase13-email-${shortId}`,
    from: "BinaHub <noreply@binahub.id>",
    to: [recipientEmail],
    subject: "Phase 13 Resend webhook evidence",
    tags: { category: "phase13_evidence" },
    bounce: { type: "hard", subType: "invalid_recipient", message: "Synthetic Phase 13 test event" },
  },
});
const headers = {
  "Content-Type": "application/json",
  "svix-id": webhookId,
  "svix-timestamp": timestamp,
  "svix-signature": signWebhook(webhookSecret, webhookId, timestamp, payload),
};

const first = await requestJson("/api/integrations/resend/webhook", { method: "POST", headers, body: payload });
check(
  first.status === 200 && first.body?.success === true && first.body?.eventType === "email.bounced",
  "Webhook Resend bertanda tangan valid diproses",
  `HTTP ${first.status}`,
);

const duplicate = await requestJson("/api/integrations/resend/webhook", { method: "POST", headers, body: payload });
check(
  duplicate.status === 200 && duplicate.body?.success === true && duplicate.body?.duplicate === true,
  "Webhook Resend duplicate tidak diproses ulang",
  `HTTP ${duplicate.status}`,
);

const [delivery, suppression] = await Promise.all([
  db.from("email_delivery_events")
    .select("event_type, recipient_email, processing_status")
    .eq("provider", "resend")
    .eq("webhook_id", webhookId)
    .maybeSingle(),
  db.from("email_suppressions")
    .select("email, reason, source")
    .eq("email", recipientEmail)
    .maybeSingle(),
]);
if (delivery.error) fail(`Audit delivery event tidak dapat dibaca: ${delivery.error.message}`);
else check(
  delivery.data?.event_type === "email.bounced"
    && delivery.data?.recipient_email === recipientEmail
    && delivery.data?.processing_status === "processed",
  "Delivery event tersimpan sekali dan dapat diaudit",
);

if (suppression.error) fail(`Audit suppression tidak dapat dibaca: ${suppression.error.message}`);
else check(
  suppression.data?.email === recipientEmail
    && suppression.data?.reason === "bounce"
    && suppression.data?.source === "resend_webhook",
  "Bounce membuat suppression yang benar",
);

if (failures.length) {
  console.error(`\nPhase 13 Resend evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 Resend evidence lulus terhadap ${baseUrl}.`);
console.log("Event menggunakan alamat example.invalid, tidak mengirim email, dan tidak mencetak secret.");
