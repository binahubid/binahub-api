import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_PROPOSAL_GATE_TEST === "true";
const runLabel = process.env.PHASE13_RUN_LABEL?.trim() || "phase13-proposal-gate";
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

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`Environment ${name} belum tersedia.`);
  return value || "";
}

async function requestJson(path, accessToken, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_PROPOSAL_GATE_TEST=true untuk mengizinkan evidence proposal gate ke production.");
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
pass("Administrator memperoleh sesi sementara untuk evidence proposal gate");

const { data: moduleRow, error: moduleError } = await db
  .from("catalog_modules")
  .select("id, module_code, readiness_status, is_mock")
  .eq("active", true)
  .eq("is_mock", true)
  .order("created_at", { ascending: true })
  .limit(1)
  .maybeSingle();
if (moduleError || !moduleRow) {
  fail(`Modul mock aktif untuk hard-block evidence tidak tersedia: ${moduleError?.message || "data kosong"}`);
}
if (failures.length) process.exit(1);
pass("Modul mock aktif ditemukan sebagai fixture hard blocker");

const shortId = randomUUID().replace(/-/g, "").slice(0, 12);
const fixtureEmail = `${normalizedLabel}-${shortId.slice(0, 6)}@example.invalid`;
const { data: assessment, error: assessmentError } = await db.from("assessments").insert({
  form_data: {
    name: "Phase 13 Proposal Gate",
    email: fixtureEmail,
    company: `Phase 13 Proposal ${shortId}`,
    role: "UAT Owner",
    employees: "20 - 99",
    challenge: "Controlled proposal gate evidence.",
    target: "Verify hard blockers cannot be approved or sent.",
  },
  scores: { Insights: 60, Lab: 60, Coach: 60, Play: 60, Academy: 60, Works: 60, Impact: 60 },
  category: "PROFESIONAL",
  ai_analysis: "Synthetic Phase 13 proposal-gate evidence.",
  recommendations: [],
  overall_score: 60,
  assessment_status: "UAT Proposal Gate",
  proposal_status: "Belum Diminta",
  follow_up_paused: true,
}).select("id").single();
if (assessmentError || !assessment) {
  fail(`Assessment UAT terisolasi tidak dapat dibuat: ${assessmentError?.message || "data kosong"}`);
}
if (failures.length) process.exit(1);
pass("Assessment UAT terisolasi dibuat menggunakan alamat example.invalid");

const draft = await requestJson("/api/admin/proposals/draft", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    assessmentId: assessment.id,
    moduleItems: [{ catalogModuleId: moduleRow.id, quantity: 1 }],
    scopeType: "custom",
    discountPercent: 100,
    aiConfidence: 0.1,
    riskFlags: ["phase13-controlled-risk"],
    notes: "Synthetic Phase 13 hard-block evidence. Do not approve or send.",
    proposalContext: {
      organizationName: `Phase 13 Proposal ${shortId}`,
    },
  }),
});
const reasonCodes = new Set((draft.body?.gate?.reasons || []).map((reason) => reason.code));
check(draft.status === 200 && draft.body?.success === true, "Draft proposal dibuat melalui API production", `HTTP ${draft.status}`);
check(draft.body?.gate?.status === "pending_approval", "Draft masuk antrean human approval");
check(reasonCodes.has("MODULE_NOT_READY"), "Modul yang belum siap menjadi hard blocker");
check(reasonCodes.has("DISCOUNT_LIMIT_EXCEEDED"), "Diskon melewati batas absolut menjadi hard blocker");
check(reasonCodes.has("INCOMPLETE_DATA"), "Data proposal tidak lengkap menjadi hard blocker");

const approval = await requestJson("/api/admin/proposals/approval", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    assessmentId: assessment.id,
    decision: "approve",
    note: "Phase 13 controlled approval-block check.",
  }),
});
check(
  approval.status === 409 && approval.body?.code === "PROPOSAL_HARD_BLOCKED",
  "Approval tidak dapat melewati hard blocker",
  `HTTP ${approval.status}, code ${approval.body?.code || "-"}`,
);

const send = await requestJson("/api/admin/assessments", accessToken, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: assessment.id, action: "send_proposal" }),
});
check(
  send.status === 409 && send.body?.code === "PROPOSAL_GATE_BLOCKED",
  "Pengiriman proposal tidak dapat melewati human gate",
  `HTTP ${send.status}, code ${send.body?.code || "-"}`,
);

const [assessmentAfter, pendingApproval, audit] = await Promise.all([
  db.from("assessments")
    .select("proposal_gate_status, proposal_gate_reasons, proposal_status, proposal_sent_at, proposal_email_id, proposal_approved_at, proposal_approved_by")
    .eq("id", assessment.id)
    .single(),
  db.from("proposal_approvals")
    .select("status, requested_by, decided_at, decided_by")
    .eq("assessment_id", assessment.id)
    .eq("status", "pending")
    .maybeSingle(),
  db.from("automation_events")
    .select("event_type, actor, status")
    .eq("target_type", "assessment")
    .eq("target_id", assessment.id)
    .eq("event_type", "proposal_draft_generated")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle(),
]);
for (const [name, result] of Object.entries({ assessmentAfter, pendingApproval, audit })) {
  if (result.error) fail(`${name} tidak dapat diverifikasi: ${result.error.message}`);
}
check(
  assessmentAfter.data?.proposal_gate_status === "pending_approval"
    && assessmentAfter.data?.proposal_status === "Menunggu Approval",
  "Status proposal tetap menunggu keputusan manusia",
);
check(
  assessmentAfter.data?.proposal_sent_at === null
    && assessmentAfter.data?.proposal_email_id === null,
  "Tidak ada proposal atau email yang dikirim",
);
check(
  assessmentAfter.data?.proposal_approved_at === null
    && assessmentAfter.data?.proposal_approved_by === null,
  "Tidak ada approval yang tercatat",
);
check(
  pendingApproval.data?.status === "pending"
    && pendingApproval.data?.requested_by === adminEmail
    && pendingApproval.data?.decided_at === null
    && pendingApproval.data?.decided_by === null,
  "Antrean approval menyimpan requester dan belum memiliki decision actor",
);
check(
  audit.data?.event_type === "proposal_draft_generated"
    && audit.data?.actor === adminEmail
    && audit.data?.status === "pending_approval",
  "Pembuatan draft memiliki audit actor dan status",
);

if (failures.length) {
  console.error(`\nPhase 13 proposal-gate evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

const { data: uatScenario, error: uatScenarioError } = await db.from("uat_scenarios")
  .select("id")
  .eq("scenario_key", "proposal_human_gate")
  .single();
if (uatScenarioError || !uatScenario) {
  fail(`Skenario UAT proposal_human_gate tidak ditemukan: ${uatScenarioError?.message || "data kosong"}`);
} else {
  const { error: uatUpdateError } = await db.rpc("update_uat_scenario", {
    p_scenario_id: uatScenario.id,
    p_actor: adminEmail,
    p_status: "passed",
    p_owner: adminEmail,
    p_environment: "production",
    p_evidence_note: `Runner ${normalizedLabel}: assessment ${assessment.id} menghasilkan draft pending; hard blocker MODULE_NOT_READY, DISCOUNT_LIMIT_EXCEEDED, dan INCOMPLETE_DATA menolak approval serta send.`,
    p_evidence_url: null,
    p_actual_result: "Proposal custom/hard-block tetap menunggu human approval; upaya approve dan send ditolak HTTP 409, tanpa proposal/email terkirim.",
    p_blocker_reason: null,
  });
  if (uatUpdateError) fail(`Evidence UAT proposal_human_gate tidak dapat dicatat: ${uatUpdateError.message}`);
  else pass("Skenario UAT proposal_human_gate dicatat passed");
}
if (failures.length) {
  console.error(`\nPhase 13 proposal-gate evidence gagal saat pencatatan UAT (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 proposal-gate evidence lulus terhadap ${baseUrl}.`);
console.log(`Fixture assessment: ${assessment.id}`);
console.log("Evidence memakai example.invalid, tidak mengirim email, tidak menyetujui proposal, tidak mengaktifkan automation, dan tidak mencetak token atau kata sandi.");
