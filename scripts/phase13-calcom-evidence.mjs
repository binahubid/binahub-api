import { createHmac, randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_CALCOM_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || "phase13-calcom";
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

function signWebhook(secret, rawBody) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
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

async function submitWebhook(secret, event) {
  const rawBody = JSON.stringify(event);
  return requestJson("/api/integrations/cal-com/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-cal-signature-256": signWebhook(secret, rawBody),
    },
    body: rawBody,
  });
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_CALCOM_TEST=true untuk mengizinkan evidence webhook Cal.com ke production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const webhookSecret = requiredEnvironment("CALCOM_WEBHOOK_SECRET");
if (webhookSecret && webhookSecret.length < 24) fail("CALCOM_WEBHOOK_SECRET harus memiliki sedikitnya 24 karakter.");
if (failures.length) process.exit(1);

const normalizedLabel = runLabel.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 36);
if (normalizedLabel.length < 5) fail("PHASE13_RUN_LABEL minimal lima karakter setelah normalisasi.");
if (failures.length) process.exit(1);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
const testEmail = `${normalizedLabel}-${shortId.slice(0, 6)}@example.invalid`;
const seriesUid = `phase13-series-${shortId}`;
const createdUid = `phase13-created-${shortId}`;
const rescheduledUid = `phase13-rescheduled-${shortId}`;
const noShowUid = `phase13-no-show-${shortId}`;
const now = Date.now();
const startAt = new Date(now + 86_400_000).toISOString();
const endAt = new Date(now + 86_400_000 + 1_800_000).toISOString();
const rescheduledStartAt = new Date(now + 172_800_000).toISOString();
const rescheduledEndAt = new Date(now + 172_800_000 + 1_800_000).toISOString();
const noShowStartAt = new Date(now + 259_200_000).toISOString();
const noShowEndAt = new Date(now + 259_200_000 + 1_800_000).toISOString();

function bookingEvent(triggerEvent, uid, startTime, endTime, extras = {}) {
  return {
    triggerEvent,
    createdAt: new Date().toISOString(),
    payload: {
      uid,
      iCalUID: seriesUid,
      type: "konsultasi-kebutuhan-binahub",
      title: "Phase 13 Cal.com webhook evidence",
      startTime,
      endTime,
      attendees: [{
        name: "Phase 13 Cal.com Evidence",
        email: testEmail,
        timeZone: "Asia/Jakarta",
      }],
      organizer: { email: "noreply@binahub.id" },
      metadata: { videoCallUrl: "https://example.invalid/phase13-calcom" },
      ...extras,
    },
  };
}

const created = await submitWebhook(webhookSecret, bookingEvent("BOOKING_CREATED", createdUid, startAt, endAt));
check(
  created.status === 200 && created.body?.success === true && created.body?.status === "confirmed",
  "Booking created bertanda tangan valid diproses",
  `HTTP ${created.status}`,
);

const rescheduled = await submitWebhook(
  webhookSecret,
  bookingEvent("BOOKING_RESCHEDULED", rescheduledUid, rescheduledStartAt, rescheduledEndAt),
);
check(
  rescheduled.status === 200 && rescheduled.body?.success === true && rescheduled.body?.status === "rescheduled",
  "Booking rescheduled mempertahankan lineage konsultasi",
  `HTTP ${rescheduled.status}`,
);

const cancelled = await submitWebhook(
  webhookSecret,
  bookingEvent("BOOKING_CANCELLED", rescheduledUid, rescheduledStartAt, rescheduledEndAt, {
    cancellationReason: "Synthetic Phase 13 cancellation evidence",
  }),
);
check(
  cancelled.status === 200 && cancelled.body?.success === true && cancelled.body?.status === "cancelled",
  "Booking cancelled diproses tanpa menghapus audit",
  `HTTP ${cancelled.status}`,
);

const noShowEvent = bookingEvent("BOOKING_NO_SHOW_UPDATED", noShowUid, noShowStartAt, noShowEndAt, {
  noShowGuest: true,
});
const noShow = await submitWebhook(webhookSecret, noShowEvent);
check(
  noShow.status === 200 && noShow.body?.success === true && noShow.body?.status === "no_show",
  "No-show peserta bertanda tangan valid diproses",
  `HTTP ${noShow.status}`,
);

const duplicateNoShow = await submitWebhook(webhookSecret, noShowEvent);
check(
  duplicateNoShow.status === 200 && duplicateNoShow.body?.success === true && duplicateNoShow.body?.duplicate === true,
  "Webhook no-show duplikat tidak diproses ulang",
  `HTTP ${duplicateNoShow.status}`,
);

const [lead, createdBooking, rescheduledBooking, noShowBooking, events] = await Promise.all([
  db.from("leads")
    .select("id, lifecycle_stage, opportunity_stage, outreach_paused, outreach_pause_reason, outreach_paused_by")
    .eq("email", testEmail)
    .maybeSingle(),
  db.from("calendar_bookings").select("status, provider_series_uid").eq("provider", "cal.com").eq("provider_uid", createdUid).maybeSingle(),
  db.from("calendar_bookings").select("status, provider_series_uid").eq("provider", "cal.com").eq("provider_uid", rescheduledUid).maybeSingle(),
  db.from("calendar_bookings").select("status, provider_series_uid").eq("provider", "cal.com").eq("provider_uid", noShowUid).maybeSingle(),
  db.from("calendar_webhook_events")
    .select("trigger_event, processing_status")
    .eq("provider", "cal.com")
    .in("provider_uid", [createdUid, rescheduledUid, noShowUid]),
]);

for (const [name, result] of Object.entries({ lead, createdBooking, rescheduledBooking, noShowBooking, events })) {
  if (result.error) fail(`${name} tidak dapat diverifikasi: ${result.error.message}`);
}

const activities = lead.data?.id
  ? await db.from("opportunity_activities")
    .select("event_type, actor")
    .eq("lead_id", lead.data.id)
    .eq("actor", "calcom-webhook")
    .in("event_type", [
      "calendar_booking_confirmed",
      "calendar_booking_rescheduled",
      "calendar_booking_cancelled",
      "calendar_booking_no_show",
    ])
  : { data: null, error: { message: "Lead UAT tidak tersedia untuk audit activity." } };
if (activities.error) fail(`activities tidak dapat diverifikasi: ${activities.error.message}`);

check(
  lead.data?.lifecycle_stage === "lead"
    && lead.data?.opportunity_stage === "consultation"
    && lead.data?.outreach_paused === true
    && lead.data?.outreach_pause_reason === "calcom_no_show_requires_human_review"
    && lead.data?.outreach_paused_by === "calcom-webhook",
  "No-show menjeda outreach dan opportunity tetap consultation",
);
check(
  createdBooking.data?.status === "rescheduled" && createdBooking.data?.provider_series_uid === seriesUid,
  "Slot awal ditutup sebagai rescheduled pada series yang sama",
);
check(
  rescheduledBooking.data?.status === "cancelled" && rescheduledBooking.data?.provider_series_uid === seriesUid,
  "Slot hasil reschedule tercatat cancelled pada series yang sama",
);
check(
  noShowBooking.data?.status === "no_show" && noShowBooking.data?.provider_series_uid === seriesUid,
  "Booking no-show tersimpan pada audit kalender",
);
const processedTriggers = new Set((events.data || [])
  .filter((event) => event.processing_status === "processed")
  .map((event) => event.trigger_event));
check(
  ["BOOKING_CREATED", "BOOKING_RESCHEDULED", "BOOKING_CANCELLED", "BOOKING_NO_SHOW_UPDATED"].every((trigger) => processedTriggers.has(trigger)),
  "Empat webhook lifecycle tersimpan sebagai processed",
);
const activityTypes = new Set((activities.data || []).map((activity) => activity.event_type));
check(
  ["calendar_booking_confirmed", "calendar_booking_rescheduled", "calendar_booking_cancelled", "calendar_booking_no_show"].every((eventType) => activityTypes.has(eventType)),
  "Lifecycle memiliki opportunity activity audit",
);

if (failures.length) {
  console.error(`\nPhase 13 Cal.com evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 Cal.com evidence lulus terhadap ${baseUrl}.`);
console.log("Evidence memakai alamat example.invalid dan webhook signed synthetic; tidak membuat booking Cal.com, tidak mengirim email, dan tidak mencetak secret.");
