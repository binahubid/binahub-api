import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE15_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE15_CONFIRM_PRODUCTION_READINESS === "true";
const failures = [];

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  check(Boolean(value), `environment ${name} tersedia`);
  return value || "";
}

check(Boolean(baseUrl && /^https:\/\//.test(baseUrl)), "target API memakai HTTPS");
if (baseUrl === "https://api.binahub.id") {
  check(productionConfirmed, "readiness production dikonfirmasi eksplisit");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const adminEmail = requiredEnvironment("PHASE15_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("PHASE15_ADMIN_PASSWORD");
if (failures.length) process.exit(1);

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: adminEmail,
  password: adminPassword,
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara");
if (!token || failures.length) process.exit(1);

const anonymous = await jsonRequest("/api/admin/pilot-operations");
check(anonymous.response.status === 401, "control plane menolak akses anonim", `HTTP ${anonymous.response.status}`);

const operations = await jsonRequest("/api/admin/pilot-operations", {
  headers: { Authorization: `Bearer ${token}` },
});
check(
  operations.response.status === 200 && operations.body?.success === true,
  "administrator dapat membaca control plane",
  `HTTP ${operations.response.status}`,
);

const controls = Array.isArray(operations.body?.controls) ? operations.body.controls : [];
check(controls.length === 4, "empat runtime control tersedia", `ditemukan ${controls.length}`);
check(
  controls.every((item) => ["dry_run", "disabled"].includes(item.effectiveMode)),
  "seluruh workflow tetap efektif dry-run atau disabled",
);
check(
  controls.every((item) => item.pilotMasterSwitchEnabled === false),
  "master switch pilot production masih tertutup",
);
check(
  controls.every((item) => item.liveMasterSwitchEnabled === false),
  "master switch live production masih tertutup",
);
check(
  controls.every((item) => typeof item.releaseWindowState === "string" && Array.isArray(item.activationBlockers)),
  "setiap runtime memuat evaluasi change window dan blocker",
);

for (const [label, path, init] of [
  ["follow-up scheduler", "/api/admin/follow-up"],
  ["client operations", "/api/automation/client-operations"],
  ["acquisition processor", "/api/automation/acquisition"],
  ["transformation worker", "/api/events/process", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }],
]) {
  const probe = await jsonRequest(path, init);
  check([401, 403].includes(probe.response.status), `${label} menolak pemanggil tanpa secret`, `HTTP ${probe.response.status}`);
}

await supabase.auth.signOut();

if (failures.length) {
  console.error(`\nPhase 15 smoke gate gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 15 controlled-pilot safety gate lulus terhadap ${baseUrl}.`);
console.log("Runner hanya membaca control plane dan menguji boundary tanpa secret; tidak ada workflow, outbound, atau mutasi bisnis yang dijalankan.");
