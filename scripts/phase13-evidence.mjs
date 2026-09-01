import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_DRY_RUN === "true";
const uatActor = process.env.PHASE13_UAT_ACTOR?.trim().toLowerCase() || "admin@binahub.id";
const failures = [];
const expectedWorkflows = [
  "follow_up_scheduler",
  "transformation_event_worker",
  "client_operations_daily",
  "acquisition_batch_processor",
];

function fail(message) {
  failures.push(message);
  console.error(`[FAIL] ${message}`);
}

function pass(message) {
  console.log(`[PASS] ${message}`);
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

function jakartaDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function runLabel() {
  const supplied = process.env.PHASE13_RUN_LABEL?.trim();
  if (supplied) {
    if (!/^[a-z0-9][a-z0-9-]{4,79}$/.test(supplied)) {
      fail("PHASE13_RUN_LABEL hanya boleh berisi huruf kecil, angka, dan tanda hubung (5–80 karakter).");
    }
    return supplied;
  }
  return `phase13-${new Date().toISOString().replace(/[:.]/g, "-").toLowerCase()}`;
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const body = await response.json().catch(() => ({ parseError: true }));
  return { status: response.status, body };
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
}
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_DRY_RUN=true untuk mengizinkan evidence run ke API production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL") || requiredEnvironment("SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const followUpSecret = requiredEnvironment("FOLLOW_UP_CRON_SECRET");
const workerSecret = requiredEnvironment("TRANSFORMATION_WORKER_SECRET");
const operationsSecret = requiredEnvironment("OPERATIONS_CRON_SECRET");
const acquisitionSecret = requiredEnvironment("ACQUISITION_CRON_SECRET");
const monitorSecret = requiredEnvironment("PILOT_MONITOR_SECRET");

if (failures.length) process.exit(1);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const label = runLabel();
const referenceDate = jakartaDate();

if (failures.length) process.exit(1);

console.log(`Phase 13 evidence run: ${label}`);
console.log(`Target: ${baseUrl}`);
console.log(`Reference date: ${referenceDate} (Asia/Jakarta)`);

const runtimeResult = await db
  .from("automation_runtime_controls")
  .select("workflow_key, requested_mode, pilot_release_id, version")
  .in("workflow_key", expectedWorkflows)
  .order("workflow_key");

if (runtimeResult.error) {
  fail(`Runtime control tidak dapat diverifikasi: ${runtimeResult.error.message}`);
} else {
  const rows = runtimeResult.data || [];
  check(rows.length === expectedWorkflows.length, "Empat runtime control tersedia", `ditemukan ${rows.length}`);
  for (const workflowKey of expectedWorkflows) {
    const row = rows.find((item) => item.workflow_key === workflowKey);
    check(
      row?.requested_mode === "dry_run",
      `${workflowKey} dikunci dry-run oleh database`,
      `requested_mode=${row?.requested_mode || "missing"}`,
    );
  }
}

if (failures.length) {
  console.error("\nEvidence run dihentikan sebelum memanggil worker karena preflight tidak aman.");
  process.exit(1);
}

const followUp = await requestJson("/api/admin/follow-up", {
  headers: {
    Authorization: `Bearer ${followUpSecret}`,
    "X-Idempotency-Key": `${label}-follow-up`,
  },
});
const followUpDeferred = followUp.status === 202 && followUp.body?.deferred === true;
const followUpDryRun = followUp.status === 200 && followUp.body?.dryRun === true;
check(
  followUpDeferred || followUpDryRun,
  "Follow-up Scheduler hanya deferred atau dry-run",
  `HTTP ${followUp.status}`,
);
check(
  Array.isArray(followUp.body?.sent) && followUp.body.sent.length === 0,
  "Follow-up Scheduler tidak mengirim email",
  `sent=${Array.isArray(followUp.body?.sent) ? followUp.body.sent.length : "invalid"}`,
);
console.log(JSON.stringify({
  followUp: {
    status: followUp.status,
    deferred: followUpDeferred,
    reason: followUp.body?.reason || null,
    dryRun: followUp.body?.dryRun ?? null,
    candidateCount: Array.isArray(followUp.body?.candidates) ? followUp.body.candidates.length : 0,
    sentCount: Array.isArray(followUp.body?.sent) ? followUp.body.sent.length : 0,
    failureCount: Array.isArray(followUp.body?.failures) ? followUp.body.failures.length : 0,
  },
}, null, 2));

const transformationKey = `${label}-transformation`;
const transformation = await requestJson("/api/events/process", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Worker-Secret": workerSecret,
    "X-Idempotency-Key": transformationKey,
  },
  body: JSON.stringify({ limit: 10 }),
});
check(
  transformation.status === 200 && transformation.body?.dryRun === true,
  "Transformation Event Worker berjalan dry-run",
  `HTTP ${transformation.status}, dryRun=${transformation.body?.dryRun}`,
);
check(
  Array.isArray(transformation.body?.processed) && transformation.body.processed.length === 0,
  "Transformation Event Worker tidak memproses event live",
  `processed=${Array.isArray(transformation.body?.processed) ? transformation.body.processed.length : "invalid"}`,
);
console.log(JSON.stringify({
  transformation: {
    status: transformation.status,
    dryRun: transformation.body?.dryRun ?? null,
    pendingDue: transformation.body?.pendingDue ?? null,
    processedCount: Array.isArray(transformation.body?.processed) ? transformation.body.processed.length : null,
  },
}, null, 2));

async function runIdempotencyPair(name, path, secret, key) {
  const headers = {
    Authorization: `Bearer ${secret}`,
    "X-Idempotency-Key": key,
  };
  const first = await requestJson(path, { headers });
  const second = await requestJson(path, { headers });
  const firstDryRun = first.body?.dryRun === true || first.body?.result?.dryRun === true || first.body?.run?.dry_run === true;
  const secondDryRun = second.body?.dryRun === true || second.body?.result?.dryRun === true || second.body?.run?.dry_run === true;
  check(first.status === 200 && firstDryRun, `${name} attempt pertama dry-run`, `HTTP ${first.status}`);
  check(second.status === 200 && second.body?.duplicate === true && secondDryRun, `${name} duplicate ditolak aman`, `HTTP ${second.status}`);
  console.log(JSON.stringify({
    [name]: {
      firstStatus: first.status,
      firstDryRun,
      firstRunId: first.body?.runId || first.body?.run?.id || null,
      secondStatus: second.status,
      duplicate: second.body?.duplicate === true,
      secondDryRun,
    },
  }, null, 2));
}

async function runRetryProbe(name, workflowKey, path, secret, key) {
  const seeded = await db.from("automation_runs").insert({
    workflow_key: workflowKey,
    idempotency_key: key,
    trigger_source: "phase13_retry_probe",
    dry_run: true,
    status: "failed",
    reference_date: referenceDate,
    candidate_count: 0,
    processed_count: 0,
    failure_count: 1,
    summary: { phase13: true, syntheticFailure: true },
    error_message: "Synthetic Phase 13 retry probe.",
    finished_at: new Date().toISOString(),
  }).select("id").single();
  if (seeded.error || !seeded.data) {
    fail(`${name} failed-run probe tidak dapat dibuat: ${seeded.error?.message || "data kosong"}`);
    return;
  }

  const headers = {
    Authorization: `Bearer ${secret}`,
    "X-Idempotency-Key": key,
  };
  const retry = await requestJson(path, { headers });
  const retryDryRun = retry.body?.dryRun === true || retry.body?.result?.dryRun === true || retry.body?.run?.dry_run === true;
  check(
    retry.status === 200 && retry.body?.retried === true && retryDryRun,
    `${name} mengambil ulang failed run secara dry-run`,
    `HTTP ${retry.status}, retried=${retry.body?.retried}, dryRun=${retryDryRun}`,
  );

  const duplicate = await requestJson(path, { headers });
  check(
    duplicate.status === 200 && duplicate.body?.duplicate === true,
    `${name} retry sukses tidak diproses ulang pada request berikutnya`,
    `HTTP ${duplicate.status}, duplicate=${duplicate.body?.duplicate}`,
  );

  const saved = await db.from("automation_runs")
    .select("id, status, dry_run, failure_count")
    .eq("workflow_key", workflowKey)
    .eq("idempotency_key", key)
    .single();
  if (saved.error) fail(`${name} retry audit tidak dapat dibaca: ${saved.error.message}`);
  check(
    saved.data?.id === seeded.data.id && saved.data?.status === "succeeded" && saved.data?.dry_run === true && saved.data?.failure_count === 0,
    `${name} menggunakan run ID yang sama dan menutup retry sebagai succeeded`,
  );
}

const clientKey = `${label}-client-operations`;
await runIdempotencyPair(
  "clientOperations",
  `/api/automation/client-operations?referenceDate=${referenceDate}`,
  operationsSecret,
  clientKey,
);
await runRetryProbe(
  "clientOperationsRetry",
  "client_operations_daily",
  `/api/automation/client-operations?referenceDate=${referenceDate}`,
  operationsSecret,
  `${label}-client-operations-retry`,
);

const acquisitionKey = `${label}-acquisition`;
await runIdempotencyPair(
  "acquisition",
  "/api/automation/acquisition",
  acquisitionSecret,
  acquisitionKey,
);
await runRetryProbe(
  "acquisitionRetry",
  "acquisition_batch_processor",
  "/api/automation/acquisition",
  acquisitionSecret,
  `${label}-acquisition-retry`,
);

const runRows = await db
  .from("automation_runs")
  .select("workflow_key, idempotency_key, dry_run, status")
  .in("idempotency_key", [transformationKey, clientKey, acquisitionKey]);
if (runRows.error) {
  fail(`Audit automation run tidak dapat dibaca: ${runRows.error.message}`);
} else {
  for (const [workflowKey, key] of [
    ["transformation_event_worker", transformationKey],
    ["client_operations_daily", clientKey],
    ["acquisition_batch_processor", acquisitionKey],
  ]) {
    const rows = (runRows.data || []).filter((item) => item.workflow_key === workflowKey && item.idempotency_key === key);
    check(
      rows.length === 1 && rows[0]?.dry_run === true && rows[0]?.status === "succeeded",
      `${workflowKey} memiliki tepat satu audit run dry-run sukses`,
      `rows=${rows.length}, status=${rows[0]?.status || "missing"}`,
    );
  }
}

const monitor = await requestJson("/api/automation/pilot-monitoring", {
  headers: {
    Authorization: `Bearer ${monitorSecret}`,
    "X-Idempotency-Key": `${label}-monitor`,
  },
});
check(
  monitor.status === 200
    && monitor.body?.dryRun === true
    && monitor.body?.activationLocked === true
    && monitor.body?.outboundTriggered === false,
  "Pilot Monitoring tetap dry-run, locked, dan tanpa outbound",
  `HTTP ${monitor.status}`,
);
const workflows = Array.isArray(monitor.body?.scan?.workflows) ? monitor.body.scan.workflows : [];
console.log(JSON.stringify({
  monitoring: {
    status: monitor.status,
    dryRun: monitor.body?.dryRun ?? null,
    activationLocked: monitor.body?.activationLocked ?? null,
    outboundTriggered: monitor.body?.outboundTriggered ?? null,
    overallStatus: monitor.body?.scan?.overallStatus || null,
    snapshotId: monitor.body?.scan?.snapshot?.id || null,
    releaseId: monitor.body?.scan?.releaseId || null,
    isMock: monitor.body?.scan?.isMock ?? null,
    blockers: Array.isArray(monitor.body?.scan?.blockers)
      ? monitor.body.scan.blockers.map((item) => ({ workflowKey: item.workflowKey, code: item.code }))
      : [],
    workflows: workflows.map((item) => ({
      workflowKey: item.workflowKey,
      status: item.status,
      runCount: item.runCount,
      succeededRunCount: item.succeededRunCount,
      failedRunCount: item.failedRunCount,
    })),
  },
}, null, 2));

if (failures.length) {
  console.error(`\nPhase 13 evidence run selesai dengan ${failures.length} kegagalan.`);
  process.exit(1);
}

if (followUpDeferred) {
  console.log("\nPhase 13 evidence run aman, tetapi evidence Follow-up belum lengkap karena request deferred.");
  console.log("Ulangi pada Senin–Jumat di dalam window 08.00–17.00 WIB dengan PHASE13_RUN_LABEL baru.");
} else {
  const { data: scenario, error: scenarioError } = await db.from("uat_scenarios")
    .select("id")
    .eq("scenario_key", "automation_dry_run_audit")
    .single();
  if (scenarioError || !scenario) {
    fail(`Skenario UAT automation_dry_run_audit tidak ditemukan: ${scenarioError?.message || "data kosong"}`);
  } else {
    const { error: updateError } = await db.rpc("update_uat_scenario", {
      p_scenario_id: scenario.id,
      p_actor: uatActor,
      p_status: "passed",
      p_owner: uatActor,
      p_environment: "production",
      p_evidence_note: `Runner ${label}: empat runtime control dry_run; follow-up, event worker, client operations, acquisition, duplicate, failed-run retry, audit run, dan monitoring lock lulus tanpa outbound.`,
      p_evidence_url: null,
      p_actual_result: "Seluruh automation berjalan dry-run; tidak ada email atau mutasi live, duplicate tidak diproses ulang, failed run dapat diretry memakai run ID yang sama, dan monitoring tetap activation locked.",
      p_blocker_reason: null,
    });
    if (updateError) fail(`Evidence UAT automation_dry_run_audit tidak dapat dicatat: ${updateError.message}`);
    else pass("Skenario UAT automation_dry_run_audit dicatat passed");
  }
  if (failures.length) {
    console.error(`\nPhase 13 automation evidence gagal saat pencatatan UAT (${failures.length} pemeriksaan).`);
    process.exit(1);
  }
  console.log("\nPhase 13 automation dry-run evidence berhasil dikumpulkan.");
}
