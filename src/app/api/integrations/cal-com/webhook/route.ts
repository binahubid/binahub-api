import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { normalizeCalComWebhook, verifyCalComSignature } from "@/lib/cal-com-webhook";
import { createServerSupabase } from "@/lib/supabase";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET || "";
  if (secret.length < 24) {
    console.error("[Cal.com Webhook] CALCOM_WEBHOOK_SECRET is not configured securely.");
    return NextResponse.json({ success: false, error: "Integrasi kalender belum dikonfigurasi." }, { status: 503 });
  }

  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "Payload terlalu besar." }, { status: 413 });
  }
  if (!verifyCalComSignature(rawBody, req.headers.get("x-cal-signature-256"), secret)) {
    return NextResponse.json({ success: false, error: "Signature webhook tidak valid." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid." }, { status: 400 });
  }

  const event = normalizeCalComWebhook(body);
  const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const db = createServerSupabase();
  const { data: eventRecord, error: eventError } = await db
    .from("calendar_webhook_events")
    .upsert({
      provider: "cal.com",
      payload_hash: payloadHash,
      trigger_event: event.triggerEvent,
      provider_uid: event.providerUid,
      processing_status: event.supported ? "received" : "ignored",
    }, { onConflict: "provider,payload_hash", ignoreDuplicates: true })
    .select("id, processing_status")
    .maybeSingle();

  if (eventError) {
    console.error("[Cal.com Webhook] Event persistence failed:", eventError.message);
    return NextResponse.json({ success: false, error: "Webhook belum dapat diproses." }, { status: 503 });
  }
  if (!eventRecord) return NextResponse.json({ success: true, duplicate: true });
  if (!event.supported || !event.providerUid) {
    await db.from("calendar_webhook_events").update({
      processing_status: "ignored",
      processed_at: new Date().toISOString(),
      error_message: event.providerUid ? null : "Booking UID tidak tersedia.",
    }).eq("id", eventRecord.id);
    return NextResponse.json({ success: true, ignored: true });
  }

  try {
    let leadId: string | null = null;
    let leadOpportunityStage = "identified";
    if (event.attendeeEmail && EMAIL_PATTERN.test(event.attendeeEmail)) {
      const { data: existingLead, error: leadReadError } = await db
        .from("leads")
        .select("id, opportunity_stage")
        .eq("email", event.attendeeEmail)
        .maybeSingle();
      if (leadReadError) throw leadReadError;

      if (existingLead) {
        leadId = existingLead.id;
        leadOpportunityStage = existingLead.opportunity_stage || "identified";
        const leadUpdate: Record<string, unknown> = { last_meaningful_activity_at: new Date().toISOString() };
        if (["requested", "confirmed", "rescheduled"].includes(event.status)) {
          leadUpdate.lifecycle_stage = "lead";
          leadUpdate.opportunity_stage = "consultation";
          leadOpportunityStage = "consultation";
        }
        if (event.status === "no_show") {
          leadUpdate.outreach_paused = true;
          leadUpdate.outreach_pause_reason = "calcom_no_show_requires_human_review";
          leadUpdate.outreach_paused_at = new Date().toISOString();
          leadUpdate.outreach_paused_by = "calcom-webhook";
        }
        const { error: updateError } = await db.from("leads").update(leadUpdate).eq("id", leadId);
        if (updateError) throw updateError;
      } else {
        const { data: insertedLead, error: insertError } = await db.from("leads").insert({
          name: event.attendeeName || event.attendeeEmail,
          email: event.attendeeEmail,
          source: "cal.com",
          lifecycle_stage: "lead",
          opportunity_stage: "consultation",
          source_metadata: { provider: "cal.com", eventTypeSlug: event.eventTypeSlug },
          last_meaningful_activity_at: new Date().toISOString(),
        }).select("id").single();
        if (insertError) throw insertError;
        leadId = insertedLead.id;
        leadOpportunityStage = "consultation";
      }
    }

    const bookingPayload = {
      provider: "cal.com",
      provider_uid: event.providerUid,
      provider_series_uid: event.seriesUid || event.providerUid,
      lead_id: leadId,
      assessment_id: event.assessmentId && UUID_PATTERN.test(event.assessmentId) ? event.assessmentId : null,
      event_type_slug: event.eventTypeSlug,
      title: event.title,
      status: event.status,
      attendee_name: event.attendeeName,
      attendee_email: event.attendeeEmail,
      organizer_email: event.organizerEmail,
      start_time: event.startTime,
      end_time: event.endTime,
      time_zone: event.timeZone,
      meeting_url: event.meetingUrl,
      cancellation_reason: event.cancellationReason,
      provider_payload: event.payload,
      provider_created_at: event.createdAt,
    };

    // Cal.com changes the booking UID when a meeting is rescheduled, while
    // iCalUID remains stable for the series. Close previous active slots so a
    // reschedule/cancellation cannot leave a phantom confirmed consultation.
    if (event.seriesUid) {
      const { error: lineageError } = await db.from("calendar_bookings")
        .update({ status: "rescheduled" })
        .eq("provider", "cal.com")
        .eq("provider_series_uid", event.seriesUid)
        .neq("provider_uid", event.providerUid)
        .in("status", ["requested", "confirmed"]);
      if (lineageError) throw lineageError;
    }

    const { error: bookingError } = await db.from("calendar_bookings")
      .upsert(bookingPayload, { onConflict: "provider,provider_uid" });
    if (bookingError) throw bookingError;

    // A booked or rescheduled consultation is an explicit stop condition for
    // queued outreach. Cancellation does not auto-resume; an authorized human
    // must decide whether and where the sequence should continue.
    if (["requested", "confirmed", "rescheduled", "no_show"].includes(event.status)) {
      if (leadId) {
        const [{ error: assessmentPauseError }, { error: inquiryPauseError }] = await Promise.all([
          db.from("assessments").update({ follow_up_paused: true }).eq("lead_id", leadId),
          db.from("inquiries").update({ follow_up_paused: true }).eq("lead_id", leadId),
        ]);
        if (assessmentPauseError) throw assessmentPauseError;
        if (inquiryPauseError) throw inquiryPauseError;
      }
      if (event.assessmentId && UUID_PATTERN.test(event.assessmentId)) {
        const { error: assessmentPauseError } = await db
          .from("assessments")
          .update({ follow_up_paused: true })
          .eq("id", event.assessmentId);
        if (assessmentPauseError) throw assessmentPauseError;
      }
    }

    if (leadId) {
      const { error: activityError } = await db.from("opportunity_activities").insert({
        lead_id: leadId,
        assessment_id: event.assessmentId && UUID_PATTERN.test(event.assessmentId) ? event.assessmentId : null,
        event_type: `calendar_booking_${event.status.replace(/[^a-z0-9_]/g, "_")}`,
        from_stage: leadOpportunityStage,
        to_stage: leadOpportunityStage,
        actor: "calcom-webhook",
        note: event.status === "no_show"
          ? "Peserta tidak hadir. Outreach dijeda dan membutuhkan keputusan tindak lanjut manusia."
          : `Status konsultasi berubah menjadi ${event.status}.`,
        metadata: {
          providerUid: event.providerUid,
          triggerEvent: event.triggerEvent,
          eventTypeSlug: event.eventTypeSlug,
        },
      });
      if (activityError) throw activityError;
    }

    await db.from("calendar_webhook_events").update({
      processing_status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", eventRecord.id);

    return NextResponse.json({ success: true, status: event.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Cal.com Webhook] Processing failed:", message);
    await db.from("calendar_webhook_events").update({
      processing_status: "failed",
      processed_at: new Date().toISOString(),
      error_message: message.slice(0, 1000),
    }).eq("id", eventRecord.id);
    return NextResponse.json({ success: false, error: "Webhook gagal diproses." }, { status: 500 });
  }
}
