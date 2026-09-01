import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_CLIENT_LIFECYCLE_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || "phase13-client-lifecycle";
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
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function nextDate(days) {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_CLIENT_LIFECYCLE_TEST=true untuk mengizinkan evidence lifecycle ke production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const adminEmail = requiredEnvironment("PHASE13_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("PHASE13_ADMIN_PASSWORD");
if (failures.length) process.exit(1);

const normalizedLabel = runLabel.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
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
pass("Administrator memperoleh sesi sementara untuk evidence lifecycle");

const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
const email = `${normalizedLabel}-${shortId.slice(0, 6)}@example.invalid`;
const company = `Phase 13 Lifecycle ${shortId}`;
const { data: lead, error: leadError } = await db.from("leads").insert({
  name: "Phase 13 Client Lifecycle",
  email,
  company,
  role_title: "UAT Owner",
  industry: "UAT",
  location: "Jakarta",
  source: "phase13_client_lifecycle_evidence",
  lead_status: "won",
  lifecycle_stage: "lead",
  opportunity_stage: "won",
  source_metadata: { phase13: true, kind: "client_lifecycle", runLabel: normalizedLabel },
  qualification_profile: { role: "UAT Owner", employeeRange: "20 - 99" },
  last_meaningful_activity_at: new Date().toISOString(),
  pipeline_updated_at: new Date().toISOString(),
}).select("id").single();
if (leadError || !lead) fail(`Lead UAT won tidak dapat dibuat: ${leadError?.message || "data kosong"}`);
else pass("Lead UAT won terisolasi dibuat menggunakan alamat example.invalid");
if (failures.length) process.exit(1);

const handoffPayload = {
  leadId: lead.id,
  commercialOwner: adminEmail,
  deliveryOwner: adminEmail,
  projectTitle: "Phase 13 Initial Delivery",
  kickoffDate: nextDate(7),
};
const handoff = await requestJson("/api/admin/client-delivery", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(handoffPayload),
});
const accountId = handoff.body?.result?.account?.id;
const projectId = handoff.body?.result?.project?.id;
check(handoff.status === 200 && handoff.body?.success === true && accountId && projectId, "Won lead dikonversi melalui API menjadi client account dan project", responseDetail(handoff));

const handoffDuplicate = await requestJson("/api/admin/client-delivery", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(handoffPayload),
});
check(
  handoffDuplicate.status === 200
    && handoffDuplicate.body?.result?.account?.id === accountId
    && handoffDuplicate.body?.result?.project?.id === projectId,
  "Handoff lead won idempoten dan tidak menggandakan account/project",
  responseDetail(handoffDuplicate),
);
if (!accountId || !projectId || failures.length) process.exit(1);

const stakeholder = await requestJson("/api/admin/client-delivery/stakeholders", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientAccountId: accountId,
    name: "Phase 13 Sponsor",
    email: `sponsor-${shortId.slice(0, 6)}@example.invalid`,
    phone: null,
    roleTitle: "Executive Sponsor",
    department: "UAT",
    relationshipRole: "sponsor",
    isPrimary: false,
    active: true,
    notes: "Synthetic Phase 13 stakeholder evidence.",
  }),
});
check(stakeholder.status === 200 && stakeholder.body?.success === true, "Perubahan stakeholder tercatat melalui API", `HTTP ${stakeholder.status}`);

const projectRisk = await requestJson("/api/admin/client-delivery", accessToken, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    action: "project",
    payload: {
      projectId,
      deliveryStage: "at_risk",
      deliveryOwner: adminEmail,
      startDate: nextDate(7),
      endDate: nextDate(37),
      deliveryGoal: "Validate safe Phase 13 delivery-risk evidence.",
      successMetrics: ["Evidence trace is complete"],
      riskLevel: "high",
      riskSummary: "Synthetic delivery risk requires human follow-up.",
      note: "Phase 13 controlled risk evidence.",
    },
  }),
});
check(projectRisk.status === 200 && projectRisk.body?.success === true, "Risiko delivery memerlukan owner dan ringkasan melalui API", `HTTP ${projectRisk.status}`);

const health = await requestJson("/api/admin/client-delivery/health", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientAccountId: accountId,
    projectId,
    deliveryScore: 2,
    engagementScore: 3,
    sentimentScore: 3,
    commercialScore: 3,
    riskLevel: "at_risk",
    riskReasons: ["Synthetic Phase 13 evidence risk"],
    notes: "Controlled UAT health review.",
    nextAction: "Owner reviews the synthetic risk.",
    nextActionDueAt: nextDate(1),
  }),
});
check(health.status === 200 && health.body?.success === true, "Account health berisiko memiliki next action dan tenggat", `HTTP ${health.status}`);

const taskKey = `phase13-delivery-risk:${projectId}`;
const taskDueAt = new Date(Date.now() + 86_400_000).toISOString();
const taskCandidate = {
  taskKey,
  taskType: "delivery_risk",
  title: "Phase 13 delivery risk requires human review",
  priority: "high",
  assignedTo: adminEmail,
  dueAt: taskDueAt,
  clientAccountId: accountId,
  projectId,
  milestoneId: null,
  retentionOpportunityId: null,
  metadata: { phase13: true, runLabel: normalizedLabel, source: "controlled_uat_fixture" },
};
const { data: taskMaterialized, error: taskMaterializeError } = await db.rpc("create_limited_client_operations_tasks", {
  p_actor: "uat:phase13-client-lifecycle",
  p_candidates: [taskCandidate],
});
if (taskMaterializeError) fail(`Human task risiko tidak dapat dibuat: ${taskMaterializeError.message}`);
check(taskMaterialized?.createdCount === 1, "Risiko delivery membentuk satu human task sintetis");

const { data: taskRow, error: taskReadError } = await db.from("operational_tasks")
  .select("id, status, priority, assigned_to, due_at")
  .eq("task_key", taskKey)
  .single();
if (taskReadError || !taskRow) fail(`Human task risiko tidak dapat dibaca: ${taskReadError?.message || "data kosong"}`);
if (failures.length) process.exit(1);

const { data: duplicateTask, error: duplicateTaskError } = await db.rpc("create_limited_client_operations_tasks", {
  p_actor: "uat:phase13-client-lifecycle",
  p_candidates: [taskCandidate],
});
if (duplicateTaskError) fail(`Idempotensi human task tidak dapat diuji: ${duplicateTaskError.message}`);
check(duplicateTask?.createdCount === 0, "Kandidat risiko yang sama tidak menggandakan human task");

const taskAssigned = await requestJson("/api/admin/operations", accessToken, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    taskId: taskRow.id,
    status: "in_progress",
    priority: "high",
    assignedTo: adminEmail,
    dueAt: taskDueAt,
    resolutionNote: null,
  }),
});
check(taskAssigned.status === 200 && taskAssigned.body?.success === true, "Human task risiko menerima owner dan status in progress", `HTTP ${taskAssigned.status}`);

const taskCompleted = await requestJson("/api/admin/operations", accessToken, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    taskId: taskRow.id,
    status: "completed",
    priority: "high",
    assignedTo: adminEmail,
    dueAt: taskDueAt,
    resolutionNote: "Controlled Phase 13 risk evidence reviewed and resolved.",
  }),
});
check(taskCompleted.status === 200 && taskCompleted.body?.success === true, "Human task risiko hanya selesai dengan catatan resolusi", `HTTP ${taskCompleted.status}`);

const retention = await requestJson("/api/admin/client-delivery/retention", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientAccountId: accountId,
    sourceProjectId: projectId,
    opportunityType: "repeat",
    status: "qualified",
    owner: adminEmail,
    moduleRequestData: { source: "phase13_client_lifecycle_evidence" },
    estimatedValue: 15000000,
    expectedCloseDate: nextDate(30),
    nextAction: "Review repeat opportunity with the account owner.",
    nextActionDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    humanApproved: false,
  }),
});
check(retention.status === 200 && retention.body?.success === true && retention.body?.opportunity?.status === "qualified", "Repeat opportunity kembali ke qualified tanpa melewati human gate", `HTTP ${retention.status}`);

const [leadAfter, account, project, healthReviews, retentionRows, activities, opportunityActivities, taskAfter, taskEvents] = await Promise.all([
  db.from("leads").select("lifecycle_stage, outreach_paused, outreach_pause_reason").eq("id", lead.id).single(),
  db.from("client_accounts").select("source_lead_id, commercial_owner, delivery_owner, health_status, retain_status").eq("id", accountId).single(),
  db.from("projects").select("source_lead_id, client_account_id, initial_handoff, delivery_stage, risk_level, delivery_owner").eq("id", projectId).single(),
  db.from("account_health_reviews").select("risk_level, next_action, next_action_due_at, reviewed_by").eq("client_account_id", accountId).eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  db.from("retention_opportunities").select("status, opportunity_type, owner, human_gate_status").eq("client_account_id", accountId).eq("source_project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  db.from("client_activities").select("event_type, actor").eq("client_account_id", accountId),
  db.from("opportunity_activities").select("event_type, actor").eq("lead_id", lead.id),
  db.from("operational_tasks").select("status, priority, assigned_to, resolution_note, completed_by").eq("id", taskRow.id).single(),
  db.from("operational_task_events").select("event_type, actor").eq("task_id", taskRow.id).order("created_at", { ascending: true }),
]);
for (const [name, result] of Object.entries({ leadAfter, account, project, healthReviews, retentionRows, activities, opportunityActivities, taskAfter, taskEvents })) {
  if (result.error) fail(`${name} tidak dapat diverifikasi: ${result.error.message}`);
}
check(
  leadAfter.data?.lifecycle_stage === "client"
    && leadAfter.data?.outreach_paused === true
    && leadAfter.data?.outreach_pause_reason === "converted_to_client",
  "Lead yang dihandoff menjadi client dan outreach dihentikan",
);
check(
  account.data?.source_lead_id === lead.id
    && account.data?.commercial_owner === adminEmail
    && account.data?.delivery_owner === adminEmail
    && account.data?.health_status === "at_risk"
    && account.data?.retain_status === "opportunity",
  "Client account menyimpan owner, health status, dan retain status yang dapat diaudit",
);
check(
  project.data?.source_lead_id === lead.id
    && project.data?.client_account_id === accountId
    && project.data?.initial_handoff === true
    && project.data?.delivery_stage === "at_risk"
    && project.data?.risk_level === "high"
    && project.data?.delivery_owner === adminEmail,
  "Project delivery menyimpan lineage handoff dan risiko ber-owner",
);
check(
  healthReviews.data?.risk_level === "at_risk"
    && Boolean(healthReviews.data?.next_action)
    && Boolean(healthReviews.data?.next_action_due_at)
    && healthReviews.data?.reviewed_by === adminEmail,
  "Health review berisiko memiliki next action teraudit",
);
check(
  retentionRows.data?.status === "qualified"
    && retentionRows.data?.opportunity_type === "repeat"
    && retentionRows.data?.owner === adminEmail
    && retentionRows.data?.human_gate_status === "pending",
  "Repeat opportunity terkualifikasi tetap menunggu human gate untuk proposal/won",
);
const eventTypes = new Set((activities.data || []).map((activity) => activity.event_type));
check(
  ["client_handoff_created", "client_stakeholder_saved", "delivery_project_updated", "account_health_reviewed", "retention_opportunity_saved"].every((eventType) => eventTypes.has(eventType)),
  "Audit client menyimpan seluruh perpindahan lifecycle",
);
check(
  (opportunityActivities.data || []).some((activity) => activity.event_type === "client_handoff_created" && activity.actor === adminEmail),
  "Traceability lead ke client memiliki actor dan event source",
);
check(
  taskAfter.data?.status === "completed"
    && taskAfter.data?.priority === "high"
    && taskAfter.data?.assigned_to === adminEmail
    && Boolean(taskAfter.data?.resolution_note)
    && taskAfter.data?.completed_by === adminEmail,
  "Human task menyimpan owner, prioritas, resolusi, dan completion actor",
);
const taskEventTypes = new Set((taskEvents.data || []).map((event) => event.event_type));
check(
  ["created_by_automation", "updated", "resolved"].every((eventType) => taskEventTypes.has(eventType)),
  "Human task memiliki jejak created, updated, dan resolved",
);

if (failures.length) {
  console.error(`\nPhase 13 client lifecycle evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

const uatEvidence = [
  {
    key: "won_to_client_handoff",
    evidence: `Runner ${normalizedLabel}: lead ${lead.id} menghasilkan account ${accountId} dan project ${projectId} secara idempoten.`,
    actual: "Handoff lead won menghasilkan tepat satu client account dan project dengan commercial/delivery owner; outreach lead dihentikan.",
  },
  {
    key: "delivery_risk_human_tasks",
    evidence: `Runner ${normalizedLabel}: project ${projectId} membentuk task ${taskRow.id}; kandidat duplikat diabaikan dan event created/updated/resolved tersimpan.`,
    actual: "Risiko delivery menghasilkan satu human task ber-owner, berprioritas tinggi, bertenggat, dan hanya selesai dengan catatan resolusi.",
  },
  {
    key: "retention_repeat_loop",
    evidence: `Runner ${normalizedLabel}: account ${accountId} menyimpan health review, stakeholder, dan repeat opportunity qualified dengan human gate pending.`,
    actual: "Stakeholder dan account health tersimpan; repeat opportunity kembali ke qualified dan tidak melewati human gate proposal/won.",
  },
];
for (const evidence of uatEvidence) {
  const { data: scenario, error: scenarioError } = await db.from("uat_scenarios")
    .select("id")
    .eq("scenario_key", evidence.key)
    .single();
  if (scenarioError || !scenario) {
    fail(`Skenario UAT ${evidence.key} tidak ditemukan: ${scenarioError?.message || "data kosong"}`);
    continue;
  }
  const { error: updateError } = await db.rpc("update_uat_scenario", {
    p_scenario_id: scenario.id,
    p_actor: adminEmail,
    p_status: "passed",
    p_owner: adminEmail,
    p_environment: "production",
    p_evidence_note: evidence.evidence,
    p_evidence_url: null,
    p_actual_result: evidence.actual,
    p_blocker_reason: null,
  });
  if (updateError) fail(`Evidence UAT ${evidence.key} tidak dapat dicatat: ${updateError.message}`);
  else pass(`Skenario UAT ${evidence.key} dicatat passed`);
}
if (failures.length) {
  console.error(`\nPhase 13 client lifecycle evidence gagal saat pencatatan UAT (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 client lifecycle evidence lulus terhadap ${baseUrl}.`);
console.log("Evidence memakai lead/stakeholder example.invalid, tidak mengirim email, tidak mengaktifkan automation, dan tidak mencetak token atau kata sandi.");
