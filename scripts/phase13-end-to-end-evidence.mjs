import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_END_TO_END_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || "phase13-end-to-end";
const failures = [];

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function check(condition, message, detail) {
  if (condition) {
    pass(message);
    return;
  }
  fail(`${message}${detail ? ` — ${detail}` : ""}`);
}

function responseDetail(response) {
  const code = response.body?.code ? `, code ${response.body.code}` : "";
  const error = response.body?.error ? `, error ${response.body.error}` : "";
  return `HTTP ${response.status}${code}${error}`;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Environment ${name} belum tersedia.`);
  return value || "";
}

async function requestJson(path, accessToken, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function nextDate(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_END_TO_END_TEST=true untuk mengizinkan evidence traceability ke production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const adminEmail = requiredEnvironment("PHASE13_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("PHASE13_ADMIN_PASSWORD");
if (failures.length) process.exit(1);

const normalizedLabel = runLabel.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 28);
if (normalizedLabel.length < 5) fail("PHASE13_RUN_LABEL minimal lima karakter setelah normalisasi.");
if (failures.length) process.exit(1);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const auth = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: session, error: signInError } = await auth.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
});
if (signInError || !session.session?.access_token) {
  fail(`Admin tidak dapat membuat sesi evidence: ${signInError?.message || "session tidak tersedia"}`);
}
if (failures.length) process.exit(1);
const accessToken = session.session.access_token;
pass("Administrator memperoleh sesi sementara untuk evidence end-to-end");

const shortId = randomUUID().replace(/-/g, "").slice(0, 10);
const sourceKey = `${normalizedLabel}-${shortId}`;
const campaignCode = `P13E2E_${shortId.toUpperCase()}`;
const importKey = `${sourceKey}:batch`;
const fixtureEmail = `${normalizedLabel}-${shortId.slice(0, 6)}@example.invalid`;
const actor = adminEmail;

const { data: source, error: sourceError } = await db.rpc("save_acquisition_source", {
  p_id: null,
  p_actor: actor,
  p_source_key: sourceKey,
  p_name: `Phase 13 E2E ${shortId}`,
  p_provider_type: "other",
  p_channel: "inbound",
  p_acquisition_method: "controlled production UAT fixture",
  p_lawful_basis: "not_applicable",
  p_privacy_notice_url: null,
  p_retention_days: 30,
  p_data_owner: actor,
  p_legal_owner: actor,
  p_status: "approved",
  p_active: true,
  p_config: { phase13: true, runLabel: normalizedLabel, outboundAllowed: false },
  p_human_approved: true,
  p_approval_note: "Approved only for isolated Phase 13 example.invalid evidence.",
});
if (sourceError || !source) fail(`Source UAT tidak dapat dibuat: ${sourceError?.message || "data kosong"}`);
else pass("Source UAT ber-governance dibuat aktif untuk fixture terisolasi");
if (failures.length) process.exit(1);

let campaign = null;
let acquisitionFixtureClosed = false;

async function closeAcquisitionFixture() {
  if (acquisitionFixtureClosed) return;
  if (campaign?.id) {
    const { error } = await db.rpc("save_acquisition_campaign", {
      p_id: campaign.id,
      p_actor: actor,
      p_source_id: source.id,
      p_campaign_code: campaignCode,
      p_name: `Phase 13 Traceability ${shortId}`,
      p_objective: "assessment",
      p_channel: "organic",
      p_status: "completed",
      p_owner: actor,
      p_budget_amount: 0,
      p_currency: "IDR",
      p_starts_on: nextDate(-1),
      p_ends_on: nextDate(1),
      p_utm_config: { source: sourceKey, medium: "uat", campaign: campaignCode.toLowerCase() },
      p_target_definition: { environment: "production", fixtureDomain: "example.invalid" },
      p_human_approved: false,
      p_approval_note: "Phase 13 traceability fixture completed or interrupted.",
    });
    if (error) fail(`Campaign UAT tidak dapat ditutup: ${error.message}`);
    else pass("Campaign UAT ditutup setelah evidence selesai atau terinterupsi");
  }

  const { error } = await db.rpc("save_acquisition_source", {
    p_id: source.id,
    p_actor: actor,
    p_source_key: sourceKey,
    p_name: `Phase 13 E2E ${shortId}`,
    p_provider_type: "other",
    p_channel: "inbound",
    p_acquisition_method: "controlled production UAT fixture",
    p_lawful_basis: "not_applicable",
    p_privacy_notice_url: null,
    p_retention_days: 30,
    p_data_owner: actor,
    p_legal_owner: actor,
    p_status: "paused",
    p_active: false,
    p_config: { phase13: true, runLabel: normalizedLabel, outboundAllowed: false },
    p_human_approved: false,
    p_approval_note: "Phase 13 traceability fixture paused after evidence or interruption.",
  });
  if (error) fail(`Source UAT tidak dapat dipause: ${error.message}`);
  else pass("Source UAT dipause dan tidak lagi aktif");
  acquisitionFixtureClosed = !error;
}

async function exitAfterFixtureCleanup() {
  await closeAcquisitionFixture();
  process.exit(1);
}

const campaignResult = await db.rpc("save_acquisition_campaign", {
  p_id: null,
  p_actor: actor,
  p_source_id: source.id,
  p_campaign_code: campaignCode,
  p_name: `Phase 13 Traceability ${shortId}`,
  p_objective: "assessment",
  p_channel: "organic",
  p_status: "active",
  p_owner: actor,
  p_budget_amount: 0,
  p_currency: "IDR",
  p_starts_on: nextDate(-1),
  p_ends_on: nextDate(1),
  p_utm_config: { source: sourceKey, medium: "uat", campaign: campaignCode.toLowerCase() },
  p_target_definition: { environment: "production", fixtureDomain: "example.invalid" },
  p_human_approved: true,
  p_approval_note: "Approved only for isolated Phase 13 traceability evidence.",
});
campaign = campaignResult.data;
const campaignError = campaignResult.error;
if (campaignError || !campaign) fail(`Campaign UAT tidak dapat dibuat: ${campaignError?.message || "data kosong"}`);
else pass("Campaign UAT aktif dibuat dengan owner dan approval actor");
if (failures.length) await exitAfterFixtureCleanup();

const prospectPayload = [{
  externalId: `phase13-${shortId}`,
  name: "Phase 13 End-to-End",
  email: fixtureEmail,
  company: `Phase 13 E2E ${shortId}`,
  roleTitle: "UAT Owner",
  industry: "UAT",
  location: "Jakarta",
  employeeRange: "20 - 99",
  consentStatus: "not_required",
  sourceUrl: "https://app.binahub.id/insight",
}];
const { data: staged, error: stageError } = await db.rpc("stage_acquisition_batch", {
  p_source_id: source.id,
  p_campaign_id: campaign.id,
  p_import_key: importKey,
  p_file_name: "phase13-controlled-fixture.json",
  p_file_checksum: null,
  p_prospects: prospectPayload,
  p_actor: actor,
});
if (stageError || !staged?.batchId) fail(`Batch UAT tidak dapat di-stage: ${stageError?.message || "data kosong"}`);
check(staged?.validRows === 1 && staged?.invalidRows === 0 && staged?.suppressedRows === 0, "Prospect example.invalid lolos validasi fixture tanpa suppression");
if (failures.length) await exitAfterFixtureCleanup();

const { data: duplicateStage, error: duplicateStageError } = await db.rpc("stage_acquisition_batch", {
  p_source_id: source.id,
  p_campaign_id: campaign.id,
  p_import_key: importKey,
  p_file_name: "phase13-controlled-fixture.json",
  p_file_checksum: null,
  p_prospects: prospectPayload,
  p_actor: actor,
});
if (duplicateStageError) fail(`Idempotensi staging tidak dapat diuji: ${duplicateStageError.message}`);
check(duplicateStage?.duplicate === true && duplicateStage?.batchId === staged.batchId, "Import key yang sama tidak menggandakan batch");

const { error: reviewError } = await db.rpc("review_acquisition_batch", {
  p_batch_id: staged.batchId,
  p_actor: actor,
  p_decision: "approved",
  p_note: "Human-reviewed synthetic example.invalid batch for Phase 13 only.",
});
if (reviewError) fail(`Batch UAT tidak dapat di-approve: ${reviewError.message}`);
else pass("Batch sintetis melalui human review sebelum promotion");
if (failures.length) await exitAfterFixtureCleanup();

const { data: promotionPreview, error: previewError } = await db.rpc("promote_acquisition_batch", {
  p_batch_id: staged.batchId,
  p_actor: actor,
  p_dry_run: true,
});
if (previewError) fail(`Dry-run promotion gagal: ${previewError.message}`);
check(promotionPreview?.dryRun === true && promotionPreview?.candidateCount === 1 && promotionPreview?.promotedCount === 0, "Promotion preview dry-run menemukan satu kandidat tanpa mutasi lead");
if (failures.length) await exitAfterFixtureCleanup();

const { data: promotion, error: promotionError } = await db.rpc("promote_acquisition_batch", {
  p_batch_id: staged.batchId,
  p_actor: actor,
  p_dry_run: false,
});
if (promotionError) fail(`Promotion fixture gagal: ${promotionError.message}`);
check(promotion?.dryRun === false && promotion?.promotedCount === 1, "Prospect terkontrol dipromosikan menjadi satu lead tanpa outbound");
if (failures.length) await exitAfterFixtureCleanup();

const { data: prospect, error: prospectError } = await db.from("acquisition_prospects")
  .select("id, matched_lead_id, promoted_at, promoted_by")
  .eq("batch_id", staged.batchId)
  .eq("email_normalized", fixtureEmail)
  .single();
if (prospectError || !prospect?.matched_lead_id) fail(`Lineage prospect ke lead tidak ditemukan: ${prospectError?.message || "data kosong"}`);
if (failures.length) await exitAfterFixtureCleanup();
const leadId = prospect.matched_lead_id;
pass("Prospect menyimpan matched lead, promotion time, dan actor");

for (const [index, stage] of ["qualified", "consultation", "proposal", "negotiation", "won"].entries()) {
  const active = stage !== "won";
  const response = await requestJson("/api/admin/pipeline", accessToken, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leadId,
      stage,
      owner: actor,
      nextAction: active ? `Phase 13 controlled next action ${stage}` : null,
      nextActionDueAt: active ? new Date(Date.now() + (index + 1) * 86_400_000).toISOString() : null,
      note: `Phase 13 traceability transition to ${stage}.`,
      lostReason: null,
      opportunityValue: 25_000_000,
      leadTimeZone: "Asia/Jakarta",
      outreachPaused: stage === "consultation" || stage === "negotiation" || stage === "won" ? true : null,
      outreachPauseReason: stage === "consultation" || stage === "negotiation" || stage === "won" ? `phase13_${stage}` : null,
    }),
  });
  check(response.status === 200 && response.body?.success === true, `Opportunity berpindah ke ${stage} melalui API admin`, `HTTP ${response.status}`);
}
if (failures.length) await exitAfterFixtureCleanup();

const handoff = await requestJson("/api/admin/client-delivery", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    leadId,
    commercialOwner: actor,
    deliveryOwner: actor,
    projectTitle: `Phase 13 E2E Delivery ${shortId}`,
    kickoffDate: nextDate(7),
  }),
});
const accountId = handoff.body?.result?.account?.id;
const projectId = handoff.body?.result?.project?.id;
check(handoff.status === 200 && handoff.body?.success === true && accountId && projectId, "Lead won dihandoff menjadi client account dan project", responseDetail(handoff));
if (failures.length) await exitAfterFixtureCleanup();

const retention = await requestJson("/api/admin/client-delivery/retention", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientAccountId: accountId,
    sourceProjectId: projectId,
    opportunityType: "repeat",
    status: "qualified",
    owner: actor,
    moduleRequestData: { source: "phase13_end_to_end_evidence", prospectId: prospect.id },
    estimatedValue: 15_000_000,
    expectedCloseDate: nextDate(30),
    nextAction: "Review controlled repeat opportunity.",
    nextActionDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    humanApproved: false,
  }),
});
const retentionId = retention.body?.opportunity?.id;
check(retention.status === 200 && retention.body?.success === true && retentionId, "Client menghasilkan repeat opportunity qualified dengan human gate pending", `HTTP ${retention.status}`);

const [batchAfter, leadAfter, acquisitionEvents, opportunityEvents, clientEvents, retentionAfter] = await Promise.all([
  db.from("prospect_import_batches").select("status, promoted_rows, approved_by").eq("id", staged.batchId).single(),
  db.from("leads").select("source, source_metadata, opportunity_stage, lifecycle_stage, opportunity_owner, outreach_paused").eq("id", leadId).single(),
  db.from("acquisition_events").select("event_type, actor").eq("batch_id", staged.batchId).order("created_at", { ascending: true }),
  db.from("opportunity_activities").select("event_type, from_stage, to_stage, actor").eq("lead_id", leadId).order("created_at", { ascending: true }),
  db.from("client_activities").select("event_type, actor").eq("client_account_id", accountId).order("created_at", { ascending: true }),
  db.from("retention_opportunities").select("status, opportunity_type, owner, human_gate_status, source_project_id").eq("id", retentionId).single(),
]);
for (const [name, result] of Object.entries({ batchAfter, leadAfter, acquisitionEvents, opportunityEvents, clientEvents, retentionAfter })) {
  if (result.error) fail(`${name} tidak dapat diverifikasi: ${result.error.message}`);
}
check(batchAfter.data?.status === "completed" && batchAfter.data?.promoted_rows === 1 && batchAfter.data?.approved_by === actor, "Batch menyimpan approval actor dan satu promotion");
const metadata = leadAfter.data?.source_metadata || {};
check(
  leadAfter.data?.source === `acquisition:${sourceKey}`
    && metadata.acquisitionSourceId === source.id
    && metadata.campaignId === campaign.id
    && metadata.batchId === staged.batchId
    && metadata.prospectId === prospect.id,
  "Lead mempertahankan lineage source, campaign, batch, dan prospect",
);
check(
  leadAfter.data?.opportunity_stage === "won"
    && leadAfter.data?.lifecycle_stage === "client"
    && leadAfter.data?.opportunity_owner === actor
    && leadAfter.data?.outreach_paused === true,
  "Lead akhir berstatus client/won, ber-owner, dan outreach paused",
);
const acquisitionEventTypes = new Set((acquisitionEvents.data || []).map((event) => event.event_type));
check(["prospect_batch_staged", "prospect_batch_approved", "prospect_batch_promoted"].every((type) => acquisitionEventTypes.has(type)), "Acquisition audit memuat staged, approved, dan promoted");
const stages = new Set((opportunityEvents.data || []).map((event) => event.to_stage));
check(["qualified", "consultation", "proposal", "negotiation", "won"].every((stage) => stages.has(stage)), "Opportunity audit memuat seluruh stage sampai won");
const clientEventTypes = new Set((clientEvents.data || []).map((event) => event.event_type));
check(["client_handoff_created", "retention_opportunity_saved"].every((type) => clientEventTypes.has(type)), "Client audit memuat handoff dan repeat opportunity");
check(
  retentionAfter.data?.status === "qualified"
    && retentionAfter.data?.opportunity_type === "repeat"
    && retentionAfter.data?.owner === actor
    && retentionAfter.data?.human_gate_status === "pending"
    && retentionAfter.data?.source_project_id === projectId,
  "Repeat opportunity menyimpan source project, owner, dan human gate pending",
);
if (failures.length) await exitAfterFixtureCleanup();

await closeAcquisitionFixture();

const { data: scenario, error: scenarioError } = await db.from("uat_scenarios")
  .select("id")
  .eq("scenario_key", "end_to_end_traceability")
  .single();
if (scenarioError || !scenario) {
  fail(`Skenario UAT end_to_end_traceability tidak ditemukan: ${scenarioError?.message || "data kosong"}`);
} else {
  const { error: updateError } = await db.rpc("update_uat_scenario", {
    p_scenario_id: scenario.id,
    p_actor: actor,
    p_status: "passed",
    p_owner: actor,
    p_environment: "production",
    p_evidence_note: `Runner ${normalizedLabel}: source ${source.id}, campaign ${campaign.id}, batch ${staged.batchId}, prospect ${prospect.id}, lead ${leadId}, account ${accountId}, project ${projectId}, retention ${retentionId}.`,
    p_evidence_url: null,
    p_actual_result: "Satu fixture example.invalid tertelusur dari acquisition source/campaign dan prospect menuju lead, seluruh opportunity stage, client/project, serta repeat opportunity; setiap perpindahan memiliki ID, actor, waktu, status, dan audit event.",
    p_blocker_reason: null,
  });
  if (updateError) fail(`Evidence UAT end_to_end_traceability tidak dapat dicatat: ${updateError.message}`);
  else pass("Skenario UAT end_to_end_traceability dicatat passed");
}

if (failures.length) {
  console.error(`\nPhase 13 end-to-end evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 end-to-end evidence lulus terhadap ${baseUrl}.`);
console.log("Evidence memakai example.invalid, tidak mengirim email, menutup campaign, mempause source, tidak mengaktifkan automation, dan tidak mencetak token atau kata sandi.");
