import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError } from "@/lib/admin-api";
import { createServerSupabase } from "@/lib/supabase";

type Journey = {
  id: string;
  first_attribution: Record<string, unknown>;
  last_attribution: Record<string, unknown>;
  first_channel: string;
  last_channel: string;
  first_landing_path: string | null;
  last_path: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const db = createServerSupabase();
  const [journeysResult, eventsResult, linksResult, interestsResult] = await Promise.all([
    db.from("inbound_journeys").select("id,first_attribution,last_attribution,first_channel,last_channel,first_landing_path,last_path,first_seen_at,last_seen_at").order("last_seen_at", { ascending: false }).limit(100),
    db.from("inbound_journey_events").select("id,journey_id,event_type,route_path,channel,module_codes,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("inbound_lead_journeys").select("lead_id,journey_id,link_type,linked_at").order("linked_at", { ascending: false }).limit(300),
    db.from("inbound_catalog_interests").select("journey_id,module_code,lead_id,first_seen_at,last_seen_at,selected_at,inquiry_submitted_at").order("last_seen_at", { ascending: false }).limit(300),
  ]);

  const missing = [journeysResult.error, eventsResult.error, linksResult.error, interestsResult.error]
    .find((error) => error?.code === "42P01" || error?.message?.includes("does not exist"));
  if (missing) return NextResponse.json({ success: true, phase20Ready: false, summary: null, journeys: [], events: [], links: [], interests: [] }, { headers: { "Cache-Control": "no-store" } });
  const error = journeysResult.error || eventsResult.error || linksResult.error || interestsResult.error;
  if (error) return adminError(error.message, 500, "INBOUND_ATTRIBUTION_LOAD_FAILED");

  const journeys = (journeysResult.data || []) as Journey[];
  const events = eventsResult.data || [];
  const links = linksResult.data || [];
  const interests = interestsResult.data || [];
  const channels = journeys.reduce<Record<string, number>>((result, journey) => {
    result[journey.first_channel] = (result[journey.first_channel] || 0) + 1;
    return result;
  }, {});
  const eventCounts = events.reduce<Record<string, number>>((result, event) => {
    result[event.event_type] = (result[event.event_type] || 0) + 1;
    return result;
  }, {});

  return NextResponse.json({
    success: true,
    phase20Ready: true,
    summary: {
      journeyCount: journeys.length,
      linkedLeadCount: new Set(links.map((link) => link.lead_id)).size,
      catalogInterestCount: interests.length,
      inquiryConversionCount: eventCounts.inquiry_submitted || 0,
      assessmentConversionCount: eventCounts.assessment_submitted || 0,
      channels,
      eventCounts,
    },
    journeys,
    events,
    links,
    interests,
  }, { headers: { "Cache-Control": "no-store" } });
}
