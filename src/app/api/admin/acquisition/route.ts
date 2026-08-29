import { NextRequest, NextResponse } from "next/server";
import { adminError, parseJsonBody, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import {
  acquisitionBatchReviewSchema,
  acquisitionBatchSchema,
  acquisitionCampaignSchema,
  acquisitionSourceSchema,
} from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

function acquisitionError(message: string) {
  const known: Record<string, string> = {
    ACQUISITION_SOURCE_APPROVAL_REQUIRED: "Source approved membutuhkan lawful basis, retention, owner, privacy notice outbound, dan human approval.",
    ONLY_APPROVED_SOURCE_CAN_BE_ACTIVE: "Hanya source approved yang dapat diaktifkan.",
    ACQUISITION_SOURCE_NOT_FOUND: "Source acquisition tidak ditemukan.",
    ACQUISITION_CAMPAIGN_APPROVAL_REQUIRED: "Campaign membutuhkan source approved dan human approval.",
    ACTIVE_CAMPAIGN_DATES_REQUIRED: "Campaign aktif membutuhkan tanggal mulai dan selesai.",
    APPROVED_ACTIVE_SOURCE_REQUIRED: "Batch hanya dapat dibuat dari source approved dan aktif.",
    APPROVED_CAMPAIGN_REQUIRED: "Campaign batch harus berstatus approved atau active.",
    INVALID_PROSPECT_BATCH_SIZE: "Batch harus berisi 1–500 prospect.",
    BATCH_NOT_APPROVABLE: "Batch belum memenuhi syarat approval atau tidak memiliki prospect valid.",
    BATCH_NOT_FOUND_OR_REVIEWED: "Batch tidak ditemukan atau sudah pernah direview.",
  };
  const code = Object.keys(known).find((key) => message.includes(key));
  return code ? { code, message: known[code] } : null;
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const db = createServerSupabase();
  const [sources, campaigns, batches, prospects, events] = await Promise.all([
    db.from("acquisition_sources").select("*").order("updated_at", { ascending: false }),
    db.from("acquisition_campaigns").select("*").order("updated_at", { ascending: false }),
    db.from("prospect_import_batches").select("*").order("created_at", { ascending: false }).limit(100),
    db.from("acquisition_prospects").select("id,batch_id,name,email,company,role_title,industry,location,consent_status,validation_status,validation_reasons,matched_lead_id,created_at").order("created_at", { ascending: false }).limit(500),
    db.from("acquisition_events").select("*").order("created_at", { ascending: false }).limit(200),
  ]);
  const missing = [sources.error, campaigns.error, batches.error, prospects.error, events.error]
    .find((error) => error?.code === "42P01" || error?.message?.includes("does not exist"));
  if (missing) return NextResponse.json({ success: true, phase5Ready: false, sources: [], campaigns: [], batches: [], prospects: [], events: [] });
  const queryError = sources.error || campaigns.error || batches.error || prospects.error || events.error;
  if (queryError) return adminError(queryError.message, 500, "ACQUISITION_LOAD_FAILED");
  return NextResponse.json({ success: true, phase5Ready: true, sources: sources.data || [], campaigns: campaigns.data || [], batches: batches.data || [], prospects: prospects.data || [], events: events.data || [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const body = await parseJsonBody(req);
  if (body.error || !body.data) return adminError(body.error || "Payload tidak valid.", 400, "INVALID_ACQUISITION_PAYLOAD");
  const action = body.data.action;
  const payload = body.data.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return adminError("Payload acquisition tidak valid.", 400, "INVALID_ACQUISITION_PAYLOAD");
  const db = createServerSupabase();

  if (action === "source") {
    const parsed = acquisitionSourceSchema.safeParse(payload);
    if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Source tidak valid.", 400, "INVALID_ACQUISITION_SOURCE");
    const input = parsed.data;
    const { data, error } = await db.rpc("save_acquisition_source", {
      p_id: input.id || null, p_actor: admin.email, p_source_key: input.sourceKey, p_name: input.name,
      p_provider_type: input.providerType, p_channel: input.channel, p_acquisition_method: input.acquisitionMethod,
      p_lawful_basis: input.lawfulBasis || null, p_privacy_notice_url: input.privacyNoticeUrl || null,
      p_retention_days: input.retentionDays || null, p_data_owner: input.dataOwner || null, p_legal_owner: input.legalOwner || null,
      p_status: input.status, p_active: input.active, p_config: input.config,
      p_human_approved: input.humanApproved, p_approval_note: input.approvalNote || null,
    });
    if (error) { const known = acquisitionError(error.message); return adminError(known?.message || error.message, known ? 400 : 500, known?.code || "ACQUISITION_SOURCE_SAVE_FAILED"); }
    return NextResponse.json({ success: true, source: data });
  }

  if (action === "campaign") {
    const parsed = acquisitionCampaignSchema.safeParse(payload);
    if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Campaign tidak valid.", 400, "INVALID_ACQUISITION_CAMPAIGN");
    const input = parsed.data;
    const { data, error } = await db.rpc("save_acquisition_campaign", {
      p_id: input.id || null, p_actor: admin.email, p_source_id: input.sourceId, p_campaign_code: input.campaignCode,
      p_name: input.name, p_objective: input.objective, p_channel: input.channel, p_status: input.status,
      p_owner: input.owner, p_budget_amount: input.budgetAmount ?? null, p_currency: input.currency,
      p_starts_on: input.startsOn || null, p_ends_on: input.endsOn || null, p_utm_config: input.utmConfig,
      p_target_definition: input.targetDefinition, p_human_approved: input.humanApproved, p_approval_note: input.approvalNote || null,
    });
    if (error) { const known = acquisitionError(error.message); return adminError(known?.message || error.message, known ? 400 : 500, known?.code || "ACQUISITION_CAMPAIGN_SAVE_FAILED"); }
    return NextResponse.json({ success: true, campaign: data });
  }

  if (action === "batch") {
    const parsed = acquisitionBatchSchema.safeParse(payload);
    if (!parsed.success) return adminError(parsed.error.issues[0]?.message || "Batch tidak valid.", 400, "INVALID_ACQUISITION_BATCH");
    const input = parsed.data;
    const { data, error } = await db.rpc("stage_acquisition_batch", {
      p_source_id: input.sourceId, p_campaign_id: input.campaignId || null, p_import_key: input.importKey,
      p_file_name: input.fileName || null, p_file_checksum: input.fileChecksum || null,
      p_prospects: input.prospects, p_actor: admin.email,
    });
    if (error) { const known = acquisitionError(error.message); return adminError(known?.message || error.message, known ? 400 : 500, known?.code || "ACQUISITION_BATCH_STAGE_FAILED"); }
    return NextResponse.json({ success: true, result: data });
  }
  return adminError("Action acquisition tidak dikenal.", 400, "INVALID_ACQUISITION_ACTION");
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, acquisitionBatchReviewSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_ACQUISITION_BATCH_REVIEW");
  const { data, error } = await createServerSupabase().rpc("review_acquisition_batch", {
    p_batch_id: parsed.data.batchId, p_actor: admin.email, p_decision: parsed.data.decision, p_note: parsed.data.note,
  });
  if (error) { const known = acquisitionError(error.message); return adminError(known?.message || error.message, known ? 400 : 500, known?.code || "ACQUISITION_BATCH_REVIEW_FAILED"); }
  return NextResponse.json({ success: true, batch: data });
}
