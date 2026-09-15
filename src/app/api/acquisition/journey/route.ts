import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { corsHeadersFromRequest } from "@/lib/cors";
import { compactInboundAttribution, classifyInboundAttribution } from "@/lib/inbound-journey";
import { AttributionSchema } from "@/lib/validations";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createServerSupabase } from "@/lib/supabase";

const eventSchema = z.object({
  journeyId: z.string().uuid().optional(),
  eventType: z.enum([
    "landing_view", "catalog_view", "catalog_module_selected", "assessment_started", "inquiry_started",
  ]),
  routePath: z.string().trim().regex(/^\//, "Route harus diawali '/'.").max(2048),
  attribution: AttributionSchema.optional().default({}),
  moduleCodes: z.array(z.string().trim().regex(/^[A-Z0-9][A-Z0-9_-]{1,63}$/)).max(20).optional().default([]),
}).strict();

function errorResponse(message: string, status: number, headers: Record<string, string>) {
  return NextResponse.json({ success: false, error: message }, { status, headers });
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeadersFromRequest(req) });
}

/** Public, rate-limited evidence endpoint. It never accepts contact details and
 * it never reads journeys back to the browser. */
export async function POST(req: NextRequest) {
  const headers = corsHeadersFromRequest(req);
  const rateLimited = await enforceRateLimit(req, "inbound-journey", 120, 60 * 60);
  if (rateLimited) {
    for (const [key, value] of Object.entries(headers)) rateLimited.headers.set(key, value);
    return rateLimited;
  }

  const parsed = eventSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(parsed.error.issues[0]?.message || "Payload journey tidak valid.", 400, headers);

  const input = parsed.data;
  const attribution = compactInboundAttribution(input.attribution);
  const { data: journeyId, error } = await createServerSupabase().rpc("record_inbound_journey_event", {
    p_journey_id: input.journeyId || null,
    p_event_type: input.eventType,
    p_route_path: input.routePath,
    p_attribution: attribution,
    p_channel: classifyInboundAttribution(attribution),
    p_module_codes: [...new Set(input.moduleCodes)],
  });
  if (error || !journeyId) {
    console.error("[Inbound Journey] Tracking failed:", error?.message);
    return errorResponse("Journey belum dapat dicatat.", 503, headers);
  }
  return NextResponse.json({ success: true, journeyId }, { status: 201, headers: { ...headers, "Cache-Control": "no-store" } });
}
