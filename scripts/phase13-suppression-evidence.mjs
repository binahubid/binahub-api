import { createHmac } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_SUPPRESSION_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || "phase13-suppression";
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
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (!key.length) throw new Error("RESEND_WEBHOOK_SECRET bukan standard webhook secret yang valid.");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
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
  fail("Set PHASE13_CONFIRM_SUPPRESSION_TEST=true untuk mengizinkan suppression evidence ke production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = requiredEnvironment("RESEND_WEBHOOK_SECRET");
const followUpSecret = requiredEnvironment("FOLLOW_UP_CRON_SECRET");
if (failures.length) process.exit(1);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const normalizedLabel = runLabel.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 48);
if (normalizedLabel.length < 5) fail("PHASE13_RUN_LABEL minimal lima karakter setelah normalisasi.");
if (failures.length) process.exit(1);

const testEmail = `${normalizedLabel}@example.invalid`;
const webhookId = `msg_${normalizedLabel.replace(/-/g, "").slice(0, 45)}`;
const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString();

let lead = await db.from("leads").select("id, outreach_paused, outreach_pause_reason").eq("email", testEmail).maybeSingle();
if (lead.error) fail(`Lead UAT tidak dapat dibaca: ${lead.error.message}`);
if (!lead.data) {
  const created = await db.from("leads").insert({
    name: "Phase 13 Suppression Evidence",
    email: testEmail,
    company: "BinaHub UAT",
    source: "phase13_suppression_evidence",
    lead_status: "new",
    lifecycle_stage: "lead",
    opportunity_stage: "identified",
    source_metadata: { phase13: true, runLabel: normalizedLabel },
    created_at: threeDaysAgo,
    last_meaningful_activity_at: threeDaysAgo,
    pipeline_updated_at: threeDaysAgo,
  }).select("id, outreach_paused, outreach_pause_reason").single();
  if (created.error) fail(`Lead UAT tidak dapat dibuat: ${created.error.message}`);
  else {
    lead = created;
    pass("Lead UAT terisolasi dibuat menggunakan alamat example.invalid");
  }
} else {
  pass("Lead UAT terisolasi yang sama digunakan kembali");
}

if (!lead.data || failures.length) process.exit(1);

let inquiry = await db.from("inquiries").select("id, follow_up_paused").eq("lead_id", lead.data.id).eq("source", "phase13_suppression_evidence").maybeSingle();
if (inquiry.error) fail(`Inquiry UAT tidak dapat dibaca: ${inquiry.error.message}`);
if (!inquiry.data) {
  const created = await db.from("inquiries").insert({
    lead_id: lead.data.id,
    name: "Phase 13 Suppression Evidence",
    email: testEmail,
    message: "Synthetic production evidence; do not contact.",
    source: "phase13_suppression_evidence",
    status: "Baru",
    created_at: threeDaysAgo,
  }).select("id, follow_up_paused").single();
  if (created.error) fail(`Inquiry UAT tidak dapat dibuat: ${created.error.message}`);
  else {
    inquiry = created;
    pass("Inquiry UAT dibuat sebagai kandidat follow-up dry-run");
  }
} else {
  pass("Inquiry UAT yang sama digunakan kembali");
}

if (!inquiry.data || failures.length) process.exit(1);

const existingDelivery = await db.from("email_delivery_events")
  .select("id, processing_status")
  .eq("provider", "resend")
  .eq("webhook_id", webhookId)
  .maybeSingle();
if (existingDelivery.error) fail(`Webhook UAT tidak dapat dibaca: ${existingDelivery.error.message}`);

if (!existingDelivery.data) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const payload = JSON.stringify({
    type: "email.bounced",
    created_at: new Date().toISOString(),
    data: {
      email_id: `email-${normalizedLabel}`,
      from: "BinaHub <noreply@binahub.id>",
      to: [testEmail],
      subject: "Phase 13 suppression evidence",
      tags: { category: "phase13_evidence" },
      bounce: { type: "hard", subType: "invalid_recipient", message: "Synthetic Phase 13 test event" },
    },
  });
  const webhook = await requestJson("/api/integrations/resend/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": webhookId,
      "svix-timestamp": timestamp,
      "svix-signature": signWebhook(webhookSecret, webhookId, timestamp, payload),
    },
    body: payload,
  });
  check(webhook.status === 200 && webhook.body?.success === true, "Bounce bertanda tangan valid diproses untuk lead UAT", `HTTP ${webhook.status}`);
} else {
  check(existingDelivery.data.processing_status === "processed", "Bounce UAT terdahulu sudah berstatus processed");
}

const [leadAfter, inquiryAfter, suppression, activity] = await Promise.all([
  db.from("leads").select("outreach_paused, outreach_pause_reason, outreach_paused_by").eq("id", lead.data.id).single(),
  db.from("inquiries").select("follow_up_paused").eq("id", inquiry.data.id).single(),
  db.from("email_suppressions").select("reason, source").eq("email", testEmail).maybeSingle(),
  db.from("opportunity_activities").select("event_type, actor").eq("lead_id", lead.data.id).eq("event_type", "email_bounced").maybeSingle(),
]);
for (const [name, result] of Object.entries({ leadAfter, inquiryAfter, suppression, activity })) {
  if (result.error) fail(`${name} tidak dapat diverifikasi: ${result.error.message}`);
}
check(
  leadAfter.data?.outreach_paused === true
    && leadAfter.data?.outreach_pause_reason === "resend_bounce"
    && leadAfter.data?.outreach_paused_by === "resend-webhook",
  "Bounce menjeda outreach lead UAT dengan alasan teraudit",
);
check(inquiryAfter.data?.follow_up_paused === true, "Bounce menjeda follow-up inquiry UAT");
check(suppression.data?.reason === "bounce" && suppression.data?.source === "resend_webhook", "Alamat UAT masuk suppression list");
check(activity.data?.actor === "resend-webhook", "Stop condition memiliki activity audit");

const scheduler = await requestJson("/api/admin/follow-up", {
  headers: {
    Authorization: `Bearer ${followUpSecret}`,
    "X-Idempotency-Key": `${normalizedLabel}-scheduler`,
  },
});
if (scheduler.status === 202 && scheduler.body?.deferred === true) {
  console.log("[PENDING] Scheduler deferred di luar business window; ulangi command yang sama pada Senin–Jumat pukul 08.00–17.00 WIB.");
} else {
  const candidateIds = Array.isArray(scheduler.body?.candidates) ? scheduler.body.candidates.map((item) => item.id) : [];
  check(
    scheduler.status === 200 && scheduler.body?.dryRun === true && !candidateIds.includes(inquiry.data.id),
    "Scheduler dry-run mengabaikan inquiry yang sudah suppressed",
    `HTTP ${scheduler.status}`,
  );
}

if (failures.length) {
  console.error(`\nPhase 13 suppression evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 suppression evidence tersimpan untuk ${testEmail}.`);
console.log("Jika baris [PENDING] muncul, hanya verifikasi scheduler yang perlu diulang pada business window; tidak ada email dikirim.");
