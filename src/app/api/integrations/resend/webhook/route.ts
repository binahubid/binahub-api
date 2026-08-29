import { NextRequest, NextResponse } from "next/server";
import { Resend, type WebhookEventPayload } from "resend";
import { createServerSupabase } from "@/lib/supabase";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PERMANENT_SUPPRESSION_EVENTS = new Set([
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);
const OUTREACH_PAUSE_EVENTS = new Set([
  ...PERMANENT_SUPPRESSION_EVENTS,
  "email.failed",
  "email.received",
]);

type EmailEventData = {
  email_id?: string;
  created_at?: string;
  from?: string;
  to?: string[];
  subject?: string;
  tags?: Record<string, string> | Array<{ name?: string; value?: string }>;
};

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const bracketMatch = value.match(/<([^<>]+)>/);
  const normalized = (bracketMatch?.[1] || value).trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function eventEmail(eventType: string, data: EmailEventData) {
  return eventType === "email.received"
    ? normalizeEmail(data.from)
    : normalizeEmail(data.to?.[0]);
}

function suppressionReason(eventType: string) {
  if (eventType === "email.bounced") return "bounce";
  if (eventType === "email.complained") return "complaint";
  if (eventType === "email.suppressed") return "provider_suppression";
  return eventType.replace("email.", "");
}

function activityType(eventType: string) {
  if (eventType === "email.received") return "email_reply_received";
  return eventType.replace("email.", "email_").replace(/[^a-z0-9_]/g, "_");
}

async function pauseOutreachForEmail(
  db: ReturnType<typeof createServerSupabase>,
  email: string,
  eventType: string,
) {
  const { data: lead, error: leadError } = await db
    .from("leads")
    .select("id, opportunity_stage")
    .eq("email", email)
    .maybeSingle();
  if (leadError) throw leadError;
  if (!lead) return null;

  const now = new Date().toISOString();
  const pauseReason = eventType === "email.received"
    ? "recipient_replied_requires_human_review"
    : `resend_${suppressionReason(eventType)}`;
  const [{ error: leadUpdateError }, { error: assessmentError }, { error: inquiryError }] = await Promise.all([
    db.from("leads").update({
      outreach_paused: true,
      outreach_pause_reason: pauseReason,
      outreach_paused_at: now,
      outreach_paused_by: "resend-webhook",
      last_meaningful_activity_at: now,
      pipeline_updated_at: now,
    }).eq("id", lead.id),
    db.from("assessments").update({ follow_up_paused: true }).eq("lead_id", lead.id),
    db.from("inquiries").update({ follow_up_paused: true }).eq("lead_id", lead.id),
  ]);
  if (leadUpdateError) throw leadUpdateError;
  if (assessmentError) throw assessmentError;
  if (inquiryError) throw inquiryError;

  const { error: activityError } = await db.from("opportunity_activities").insert({
    lead_id: lead.id,
    event_type: activityType(eventType),
    from_stage: lead.opportunity_stage,
    to_stage: lead.opportunity_stage,
    actor: "resend-webhook",
    note: eventType === "email.received"
      ? "Balasan email diterima. Outreach otomatis dijeda untuk tindak lanjut manusia."
      : `Outreach otomatis dijeda karena event ${eventType}.`,
    metadata: { email, eventType, pauseReason },
  });
  if (activityError) throw activityError;
  return lead.id;
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (webhookSecret.length < 24) {
    console.error("[Resend Webhook] RESEND_WEBHOOK_SECRET is not configured securely.");
    return NextResponse.json({ success: false, error: "Integrasi email belum dikonfigurasi." }, { status: 503 });
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "Payload terlalu besar." }, { status: 413 });
  }

  const webhookId = req.headers.get("svix-id") || "";
  const timestamp = req.headers.get("svix-timestamp") || "";
  const signature = req.headers.get("svix-signature") || "";
  let event: WebhookEventPayload;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY || "re_webhook_verification_only");
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: webhookId, timestamp, signature },
      webhookSecret,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Signature webhook tidak valid." }, { status: 401 });
  }

  const data = event.data as EmailEventData;
  const recipientEmail = eventEmail(event.type, data);
  const senderEmail = normalizeEmail(data.from);
  const db = createServerSupabase();
  const { data: eventRecord, error: eventError } = await db
    .from("email_delivery_events")
    .upsert({
      provider: "resend",
      webhook_id: webhookId,
      email_id: data.email_id || null,
      event_type: event.type,
      recipient_email: recipientEmail,
      sender_email: senderEmail,
      subject: data.subject || null,
      tags: data.tags || {},
      payload: event,
      processing_status: "received",
      provider_created_at: data.created_at || null,
    }, { onConflict: "provider,webhook_id", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (eventError) {
    console.error("[Resend Webhook] Event persistence failed:", eventError.message);
    return NextResponse.json({ success: false, error: "Webhook belum dapat diproses." }, { status: 503 });
  }
  if (!eventRecord) return NextResponse.json({ success: true, duplicate: true });

  try {
    let leadId: string | null = null;
    if (recipientEmail && PERMANENT_SUPPRESSION_EVENTS.has(event.type)) {
      const { error } = await db.from("email_suppressions").upsert({
        email: recipientEmail,
        reason: suppressionReason(event.type),
        source: "resend_webhook",
        metadata: {
          eventType: event.type,
          webhookId,
          emailId: data.email_id || null,
          recordedAt: new Date().toISOString(),
        },
      }, { onConflict: "email", ignoreDuplicates: false });
      if (error) throw error;
    }
    if (recipientEmail && OUTREACH_PAUSE_EVENTS.has(event.type)) {
      leadId = await pauseOutreachForEmail(db, recipientEmail, event.type);
    }

    await db.from("email_delivery_events").update({
      processing_status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", eventRecord.id);
    return NextResponse.json({ success: true, eventType: event.type, leadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Resend Webhook] Processing failed:", message);
    await db.from("email_delivery_events").update({
      processing_status: "failed",
      processed_at: new Date().toISOString(),
      error_message: message.slice(0, 1000),
    }).eq("id", eventRecord.id);
    return NextResponse.json({ success: false, error: "Webhook gagal diproses." }, { status: 500 });
  }
}
