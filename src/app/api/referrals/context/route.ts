import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsHeadersFromRequest } from "@/lib/cors";
import { enforceRateLimit } from "@/lib/rate-limit";
import {
  lookupReferral, publicReferralContext, readReferralVisit, referralAssociateIsActive,
  referralBookingDestination, referralCode, referralCookie, referralRpc,
} from "@/lib/referrals";

const requestSchema = z.object({
  code: referralCode,
  method: z.enum(["link", "manual"]),
  journeyId: z.uuid().optional(),
}).strict();

function headers(request: NextRequest): Record<string, string> {
  return {
    ...corsHeadersFromRequest(request),
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  };
}

function unavailable(request: NextRequest) {
  return NextResponse.json({ success: false, code: "REFERRAL_UNAVAILABLE" }, { status: 503, headers: headers(request) });
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: headers(request) });
}

export async function GET(request: NextRequest) {
  try {
    const visitId = readReferralVisit(request);
    const visit = visitId ? await lookupReferral(visitId) : null;
    const activeVisit = visit && await referralAssociateIsActive(visit.associateId) ? visit : null;
    return NextResponse.json({
      context: publicReferralContext(activeVisit),
      bookingAvailable: Boolean(referralBookingDestination()),
    }, { headers: headers(request) });
  } catch {
    return unavailable(request);
  }
}

export async function POST(request: NextRequest) {
  const responseHeaders = headers(request);
  if (request.headers.get("origin") && !responseHeaders["Access-Control-Allow-Origin"]) {
    return NextResponse.json({ success: false }, { status: 403, headers: responseHeaders });
  }

  try {
    const limited = await enforceRateLimit(request, "referral-capture", 45, 3600);
    if (limited) {
      for (const [key, value] of Object.entries(responseHeaders)) limited.headers.set(key, value);
      return limited;
    }
    const input = requestSchema.safeParse(await request.json().catch(() => null));
    if (!input.success) {
      return NextResponse.json({ success: false, code: "REFERRAL_CODE_INVALID" }, { status: 400, headers: responseHeaders });
    }
    const visitId = readReferralVisit(request);
    const current = visitId ? await lookupReferral(visitId) : null;
    const bookingAvailable = Boolean(referralBookingDestination());
    if (current && await referralAssociateIsActive(current.associateId)) {
      return NextResponse.json({ context: publicReferralContext(current), bookingAvailable }, { headers: responseHeaders });
    }
    const candidate = await lookupReferral(null, input.data.code);
    if (!candidate || !await referralAssociateIsActive(candidate.associateId)) {
      return NextResponse.json({ success: false, code: "REFERRAL_CODE_INVALID" }, { status: 404, headers: responseHeaders });
    }

    const visit = await referralRpc<Awaited<ReturnType<typeof lookupReferral>>>("referral_register_visit", {
      p_code: candidate.code, p_method: input.data.method, p_journey: input.data.journeyId || null,
    });
    if (!visit?.visitId) {
      return NextResponse.json({ success: false, code: "REFERRAL_CODE_INVALID" }, { status: 404, headers: responseHeaders });
    }

    const response = NextResponse.json({ context: publicReferralContext(visit), bookingAvailable }, { headers: responseHeaders });
    const host = request.nextUrl.hostname;
    const isBinaHub = host === "binahub.id" || host.endsWith(".binahub.id");
    response.cookies.set(referralCookie, visit.visitId, {
      path: "/", httpOnly: true, sameSite: "lax", secure: isBinaHub || request.nextUrl.protocol === "https:",
      expires: new Date(visit.expiresAt),
      ...(isBinaHub ? { domain: "binahub.id" } : {}),
    });
    return response;
  } catch {
    return unavailable(request);
  }
}
