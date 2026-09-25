import { NextRequest, NextResponse } from "next/server";
import { amsIntegrationEventSchema, applyAmsAssignment, ensureAmsIdentity, verifyAmsSignature } from "@/lib/ams-integration";
import { createServerSupabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const verification = verifyAmsSignature(rawBody, request.headers.get("x-binahub-timestamp"), request.headers.get("x-binahub-signature"));
  if (!verification.ok) return NextResponse.json({ success: false, error: verification.error }, { status: verification.status });

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ success: false, error: "Payload JSON tidak valid." }, { status: 400 });
  }
  const parsed = amsIntegrationEventSchema.safeParse(value);
  if (!parsed.success) return NextResponse.json({ success: false, error: "Event integrasi AMS tidak valid." }, { status: 400 });

  const event = parsed.data;
  const db = createServerSupabase();
  const { error: claimError } = await db.from("ams_integration_events").insert({
    event_id: event.eventId,
    event_type: event.eventType,
    occurred_at: event.occurredAt,
    status: "processing",
  });
  if (claimError) {
    if (claimError.code === "23505") {
      const { data: existing } = await db.from("ams_integration_events").select("status").eq("event_id", event.eventId).maybeSingle();
      if (existing?.status === "done") {
        return NextResponse.json({ success: true, duplicate: true, status: "done" });
      }
      if (existing?.status !== "failed") {
        return NextResponse.json({ success: false, duplicate: true, status: existing?.status || "processing" }, { status: 409 });
      }
      const { data: reclaimed } = await db.from("ams_integration_events").update({
        status: "processing",
        error_message: null,
        updated_at: new Date().toISOString(),
      }).eq("event_id", event.eventId).eq("status", "failed").select("event_id").maybeSingle();
      if (!reclaimed) return NextResponse.json({ success: false, duplicate: true, status: "processing" }, { status: 409 });
    } else {
      return NextResponse.json({ success: false, error: "Event integrasi tidak dapat diklaim." }, { status: 500 });
    }
  }

  try {
    const identity = await ensureAmsIdentity(event.associate, event.occurredAt);
    const assignment = event.eventType === "assignment.changed"
      ? await applyAmsAssignment(event, identity.profileId)
      : null;
    await db.from("ams_integration_events").update({
      status: "done",
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("event_id", event.eventId);
    return NextResponse.json({ success: true, data: { profileId: identity.profileId, assignment } });
  } catch (error) {
    await db.from("ams_integration_events").update({
      status: "failed",
      error_message: error instanceof Error ? error.message.slice(0, 1000) : "Unknown integration error",
      updated_at: new Date().toISOString(),
    }).eq("event_id", event.eventId);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Sinkronisasi AMS gagal." }, { status: 500 });
  }
}
