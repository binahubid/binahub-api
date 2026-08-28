import { createHmac, timingSafeEqual } from "node:crypto";

const SUPPORTED_TRIGGERS = new Set([
  "BOOKING_CREATED",
  "BOOKING_REQUESTED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
  "BOOKING_REJECTED",
  "BOOKING_NO_SHOW_UPDATED",
  "MEETING_ENDED",
]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(record: UnknownRecord, ...keys: string[]) {
  let current: unknown = record;
  for (const key of keys) current = asRecord(current)[key];
  return stringValue(current);
}

export function verifyCalComSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const normalizedSignature = signature.trim().toLowerCase().replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/.test(normalizedSignature)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalizedSignature, "hex"));
}

export type NormalizedCalComEvent = {
  triggerEvent: string;
  supported: boolean;
  providerUid: string | null;
  status: "requested" | "confirmed" | "rescheduled" | "cancelled" | "rejected" | "completed" | "no_show";
  eventTypeSlug: string | null;
  title: string | null;
  attendeeName: string | null;
  attendeeEmail: string | null;
  organizerEmail: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string | null;
  meetingUrl: string | null;
  cancellationReason: string | null;
  assessmentId: string | null;
  createdAt: string | null;
  payload: UnknownRecord;
};

export function normalizeCalComWebhook(input: unknown): NormalizedCalComEvent {
  const envelope = asRecord(input);
  const triggerEvent = stringValue(envelope.triggerEvent) || "UNKNOWN";
  // Meeting start/end events are flat; booking events use a nested payload.
  const payload = Object.keys(asRecord(envelope.payload)).length > 0
    ? asRecord(envelope.payload)
    : envelope;
  const attendees = Array.isArray(payload.attendees) ? payload.attendees : [];
  const attendee = asRecord(attendees[0]);
  const organizer = asRecord(payload.organizer);
  const metadata = asRecord(payload.metadata);
  const responses = asRecord(payload.responses);
  const assessmentResponse = asRecord(responses.assessmentId);
  const noShow = payload.noShowHost === true || payload.noShowGuest === true || payload.absent === true;

  const status: NormalizedCalComEvent["status"] = triggerEvent === "BOOKING_REQUESTED"
    ? "requested"
    : triggerEvent === "BOOKING_RESCHEDULED"
      ? "rescheduled"
      : triggerEvent === "BOOKING_CANCELLED"
        ? "cancelled"
        : triggerEvent === "BOOKING_REJECTED"
          ? "rejected"
          : triggerEvent === "MEETING_ENDED"
            ? "completed"
            : triggerEvent === "BOOKING_NO_SHOW_UPDATED" && noShow
              ? "no_show"
              : "confirmed";

  return {
    triggerEvent,
    supported: SUPPORTED_TRIGGERS.has(triggerEvent),
    providerUid: stringValue(payload.uid) || stringValue(payload.bookingUid),
    status,
    eventTypeSlug: stringValue(payload.type) || nestedString(payload, "eventType", "slug"),
    title: stringValue(payload.title),
    attendeeName: stringValue(attendee.name) || nestedString(payload, "responses", "name", "value"),
    attendeeEmail: (stringValue(attendee.email) || nestedString(payload, "responses", "email", "value"))?.toLowerCase() || null,
    organizerEmail: stringValue(organizer.email)?.toLowerCase() || null,
    startTime: stringValue(payload.startTime),
    endTime: stringValue(payload.endTime),
    timeZone: stringValue(attendee.timeZone) || stringValue(payload.timeZone),
    meetingUrl: stringValue(metadata.videoCallUrl) || stringValue(payload.meetingUrl),
    cancellationReason: stringValue(payload.cancellationReason) || stringValue(payload.rejectionReason),
    assessmentId: stringValue(metadata.assessmentId) || stringValue(assessmentResponse.value),
    createdAt: stringValue(envelope.createdAt),
    payload,
  };
}
