import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeCalComWebhook, verifyCalComSignature } from "./cal-com-webhook";

describe("Cal.com webhook", () => {
  it("verifies the HMAC over the unchanged raw payload", () => {
    const body = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: "abc" } });
    const secret = "a-secure-webhook-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyCalComSignature(body, signature, secret)).toBe(true);
    expect(verifyCalComSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyCalComSignature(body, "invalid", secret)).toBe(false);
  });

  it("normalizes booking-created payloads", () => {
    const event = normalizeCalComWebhook({
      triggerEvent: "BOOKING_CREATED",
      createdAt: "2026-08-27T02:00:00.000Z",
      payload: {
        uid: "booking-1",
        iCalUID: "series-1@Cal.com",
        type: "consultation",
        title: "BinaHub Consultation",
        startTime: "2026-08-28T02:00:00.000Z",
        attendees: [{ name: "Dewi", email: "DEWI@example.com", timeZone: "Asia/Jakarta" }],
        organizer: { email: "owner@binahub.id" },
        metadata: { assessmentId: "8a9f9346-d3a6-4e62-9123-e567d49a6277", videoCallUrl: "https://meet.example" },
      },
    });

    expect(event.supported).toBe(true);
    expect(event.status).toBe("confirmed");
    expect(event.seriesUid).toBe("series-1@Cal.com");
    expect(event.attendeeEmail).toBe("dewi@example.com");
    expect(event.meetingUrl).toBe("https://meet.example");
  });

  it("supports Cal.com flat meeting-ended payloads", () => {
    const event = normalizeCalComWebhook({
      triggerEvent: "MEETING_ENDED",
      bookingUid: "booking-2",
      attendees: [{ email: "person@example.com" }],
    });

    expect(event.providerUid).toBe("booking-2");
    expect(event.seriesUid).toBe("booking-2");
    expect(event.status).toBe("completed");
  });

  it("keeps the iCal UID as stable lineage when a reschedule changes booking UID", () => {
    const event = normalizeCalComWebhook({
      triggerEvent: "BOOKING_RESCHEDULED",
      payload: {
        uid: "new-booking-uid",
        iCalUID: "original-booking-uid@Cal.com",
      },
    });

    expect(event.providerUid).toBe("new-booking-uid");
    expect(event.seriesUid).toBe("original-booking-uid@Cal.com");
    expect(event.status).toBe("rescheduled");
  });
});
