import { NextRequest, NextResponse } from "next/server";
import { compactInboundAttribution, classifyInboundAttribution } from "@/lib/inbound-journey";
import { outboundCampaignTokenDigest, publicWebsiteOrigin, verifyOutboundCampaignToken } from "@/lib/outbound-campaign-links";
import { createServerSupabase } from "@/lib/supabase";

function unavailable() { return new NextResponse("Link tidak tersedia.", { status: 404, headers: { "Cache-Control": "no-store" } }); }

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!verifyOutboundCampaignToken(token)) return unavailable();
  const db = createServerSupabase();
  const linkResult = await db.from("outbound_campaign_links").select("id,source_id,campaign_id,status,is_test,expires_at").eq("token_digest", outboundCampaignTokenDigest(token)).maybeSingle();
  const link = linkResult.data;
  if (linkResult.error || !link || link.status !== "active" || new Date(link.expires_at) <= new Date()) {
    if (link?.status === "active") await db.from("outbound_campaign_links").update({ status: "expired" }).eq("id", link.id);
    return unavailable();
  }
  const [campaignResult, sourceResult] = await Promise.all([
    db.from("acquisition_campaigns").select("campaign_code,status,utm_config").eq("id", link.campaign_id).maybeSingle(),
    db.from("acquisition_sources").select("source_key,status,active").eq("id", link.source_id).maybeSingle(),
  ]);
  const campaign = campaignResult.data;
  const source = sourceResult.data;
  if (!campaign || !source || !["approved", "active"].includes(campaign.status) || source.status !== "approved" || !source.active) return unavailable();
  const attribution = compactInboundAttribution({
    utmSource: typeof campaign.utm_config?.source === "string" && campaign.utm_config.source ? campaign.utm_config.source : source.source_key,
    utmMedium: typeof campaign.utm_config?.medium === "string" && campaign.utm_config.medium ? campaign.utm_config.medium : "email",
    utmCampaign: typeof campaign.utm_config?.campaign === "string" && campaign.utm_config.campaign ? campaign.utm_config.campaign : campaign.campaign_code.toLowerCase(),
    landingPage: `${publicWebsiteOrigin()}/`,
  });
  const journeyResult = await db.rpc("record_inbound_journey_event", { p_journey_id: null, p_event_type: "landing_view", p_route_path: "/", p_attribution: attribution, p_channel: classifyInboundAttribution(attribution), p_module_codes: [] });
  if (journeyResult.error || !journeyResult.data) return new NextResponse("Layanan sementara tidak tersedia.", { status: 503, headers: { "Cache-Control": "no-store" } });
  const journeyId = journeyResult.data as string;
  const [clickResult, auditResult] = await Promise.all([
    db.from("outbound_campaign_clicks").upsert({ link_id: link.id, journey_id: journeyId }, { onConflict: "link_id,journey_id" }),
    db.from("acquisition_events").insert({ source_id: link.source_id, campaign_id: link.campaign_id, event_type: "outbound_test_link_clicked", actor: "public:outbound-link", note: "Klik tautan kampanye tercatat tanpa IP atau user-agent.", metadata: { linkId: link.id, journeyId, isTest: link.is_test } }),
  ]);
  if (clickResult.error || auditResult.error) {
    return new NextResponse("Layanan sementara tidak tersedia.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const destination = new URL("/", publicWebsiteOrigin());
  destination.searchParams.set("bh_journey", journeyId);
  for (const [key, value] of Object.entries(attribution)) {
    const queryKey = key === "utmSource" ? "utm_source" : key === "utmMedium" ? "utm_medium" : key === "utmCampaign" ? "utm_campaign" : null;
    if (queryKey && value) destination.searchParams.set(queryKey, value);
  }
  return NextResponse.redirect(destination, 302);
}
