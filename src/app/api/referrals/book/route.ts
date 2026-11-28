import { NextRequest, NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { lookupReferral, readReferralVisit, referralAssociateIsActive, referralBookingDestination, referralRpc } from "@/lib/referrals";

const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };

export async function GET(request: NextRequest) {
  const destination = referralBookingDestination();
  if (!destination) {
    return NextResponse.redirect(new URL("https://binahub.id/contact"), { status: 303, headers });
  }
  const visitId = readReferralVisit(request);
  if (visitId) {
    try {
      const limited = await enforceRateLimit(request, "referral-booking", 20, 3600);
      const visit = limited ? null : await lookupReferral(visitId);
      if (visit && await referralAssociateIsActive(visit.associateId)) {
        const token = await referralRpc<string | null>("referral_issue_booking_token", { p_visit: visitId });
        if (token) destination.searchParams.set("metadata[binahub_referral]", token);
      }
    } catch {
      // The booking remains available and the webhook queues unmatched contacts.
      console.warn("[Referral booking] Token could not be issued.");
    }
  }
  return NextResponse.redirect(destination, { status: 303, headers });
}
