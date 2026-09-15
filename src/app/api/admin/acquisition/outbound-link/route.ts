import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { createServerSupabase } from "@/lib/supabase";
import { createOutboundCampaignToken, outboundCampaignTokenDigest, outboundLinkSigningReady, publicWebsiteOrigin } from "@/lib/outbound-campaign-links";

const issueSchema = z.object({
  action: z.literal("issue_test_link"),
  campaignId: z.string().uuid(),
  prospectId: z.string().uuid(),
  expiresInDays: z.number().int().min(1).max(30).default(14),
  confirmation: z.literal("ISSUE_TEST_LINK_ONLY"),
}).strict();

function missingTable(error: { code?: string; message?: string } | null | undefined) {
  return ["42P01", "42703", "PGRST204"].includes(error?.code || "") || error?.message?.includes("does not exist");
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const db = createServerSupabase();
  const [links, clicks, campaigns, prospects] = await Promise.all([
    db.from("outbound_campaign_links").select("id,campaign_id,prospect_id,status,is_test,expires_at,issued_at").order("issued_at", { ascending: false }).limit(100),
    db.from("outbound_campaign_clicks").select("link_id,journey_id,clicked_at").order("clicked_at", { ascending: false }).limit(300),
    db.from("acquisition_campaigns").select("id,campaign_code,name,source_id,status,channel").in("channel", ["email", "linkedin"]).order("updated_at", { ascending: false }).limit(100),
    db.from("acquisition_prospects").select("id,batch_id,campaign_id,source_id,name,company,validation_status,consent_status").eq("validation_status", "valid").neq("consent_status", "opted_out").order("created_at", { ascending: false }).limit(300),
  ]);
  const missing = [links.error, clicks.error].find(missingTable);
  if (missing) return NextResponse.json({ success: true, phase20Part2Ready: false, signingReady: outboundLinkSigningReady(), links: [], clicks: [], campaigns: [], prospects: [] });
  const error = links.error || clicks.error || campaigns.error || prospects.error;
  if (error) return adminError(error.message, 500, "OUTBOUND_LINK_LOAD_FAILED");
  return NextResponse.json({
    success: true, phase20Part2Ready: true, signingReady: outboundLinkSigningReady(),
    links: links.data || [], clicks: clicks.data || [], campaigns: campaigns.data || [], prospects: prospects.data || [],
    apolloPro: { providerCallsEnabled: false, discoveryEnabled: false, enrichmentEnabled: false, message: "Apollo Pro tetap terkunci; Phase 20.2 tidak memanggil API Apollo." },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  if (!outboundLinkSigningReady()) return adminError("ACQUISITION_LINK_SECRET minimal 32 karakter belum tersedia.", 409, "OUTBOUND_LINK_SECRET_REQUIRED");
  const parsed = await parseValidatedBody(req, issueSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error || "Payload tautan tidak valid.", 400, "INVALID_OUTBOUND_LINK_REQUEST");
  const db = createServerSupabase();
  const [campaignResult, prospectResult] = await Promise.all([
    db.from("acquisition_campaigns").select("id,source_id,campaign_code,status,channel").eq("id", parsed.data.campaignId).maybeSingle(),
    db.from("acquisition_prospects").select("id,batch_id,campaign_id,source_id,validation_status,consent_status").eq("id", parsed.data.prospectId).maybeSingle(),
  ]);
  if (campaignResult.error || prospectResult.error) return adminError(campaignResult.error?.message || prospectResult.error?.message || "Data acquisition tidak dapat dibaca.", 500, "OUTBOUND_LINK_LOOKUP_FAILED");
  const campaign = campaignResult.data;
  const prospect = prospectResult.data;
  if (!campaign || !prospect) return adminError("Kampanye atau prospek tidak ditemukan.", 404, "OUTBOUND_LINK_TARGET_NOT_FOUND");
  if (!["approved", "active"].includes(campaign.status) || !["email", "linkedin"].includes(campaign.channel)) return adminError("Kampanye outbound harus approved/active dan memakai kanal email atau LinkedIn.", 409, "OUTBOUND_CAMPAIGN_NOT_APPROVED");
  if (prospect.source_id !== campaign.source_id || prospect.campaign_id !== campaign.id || prospect.validation_status !== "valid" || prospect.consent_status === "opted_out") return adminError("Prospek tidak lolos source, campaign, validasi, atau suppression gate.", 409, "OUTBOUND_PROSPECT_BLOCKED");
  const sourceResult = await db.from("acquisition_sources").select("id,provider_type,channel,status,active").eq("id", campaign.source_id).maybeSingle();
  const source = sourceResult.data;
  if (sourceResult.error) return adminError(sourceResult.error.message, 500, "OUTBOUND_SOURCE_LOOKUP_FAILED");
  if (!source || source.provider_type !== "apollo" || source.channel !== "outbound" || source.status !== "approved" || !source.active) return adminError("Tautan hanya dapat dibuat dari source Apollo manual outbound yang approved dan aktif.", 409, "OUTBOUND_SOURCE_NOT_READY");

  const token = createOutboundCampaignToken();
  const expiry = new Date();
  expiry.setUTCDate(expiry.getUTCDate() + parsed.data.expiresInDays);
  const expiresAt = expiry.toISOString();
  const { data: link, error } = await db.from("outbound_campaign_links").insert({
    source_id: source.id, campaign_id: campaign.id, batch_id: prospect.batch_id, prospect_id: prospect.id,
    token_digest: outboundCampaignTokenDigest(token), status: "active", is_test: true,
    expires_at: expiresAt, issued_by: admin.email,
  }).select("id,status,expires_at,issued_at").single();
  if (error || !link) return adminError(error?.message || "Tautan UAT tidak dapat dibuat.", 500, "OUTBOUND_LINK_ISSUE_FAILED");
  await db.from("acquisition_events").insert({ source_id: source.id, campaign_id: campaign.id, batch_id: prospect.batch_id, prospect_id: prospect.id, event_type: "outbound_test_link_issued", actor: admin.email, note: "Tautan UAT dibuat; sistem tidak mengirim email.", metadata: { linkId: link.id, expiresAt, isTest: true } });
  const url = `${(process.env.NEXT_PUBLIC_BINAHUB_API_URL || "https://api.binahub.id").replace(/\/$/, "")}/api/acquisition/c/${token}`;
  return NextResponse.json({ success: true, link: { ...link, url, destination: publicWebsiteOrigin(), isTest: true }, message: "Tautan UAT dibuat. Salin hanya untuk pengujian akun internal; tidak ada email yang dikirim sistem." });
}
