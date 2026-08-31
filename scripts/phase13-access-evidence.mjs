import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = (process.env.PHASE13_API_URL || "").replace(/\/$/, "");
const productionConfirmed = process.env.PHASE13_CONFIRM_ACCESS_TEST === "true";
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

async function requestJson(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

function bearer(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function signIn(label, email, password, supabaseUrl, anonKey) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session?.access_token) {
    fail(`${label} tidak dapat login untuk evidence: ${error?.message || "session tidak tersedia"}`);
    return "";
  }
  pass(`${label} berhasil memperoleh sesi sementara`);
  return data.session.access_token;
}

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  fail("PHASE13_API_URL wajib berupa URL HTTPS eksplisit.");
}
if (baseUrl === "https://api.binahub.id" && !productionConfirmed) {
  fail("Set PHASE13_CONFIRM_ACCESS_TEST=true untuk mengizinkan access evidence ke API production.");
}

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requiredEnvironment("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const adminEmail = requiredEnvironment("PHASE13_ADMIN_EMAIL");
const adminPassword = requiredEnvironment("PHASE13_ADMIN_PASSWORD");
const nonAdminEmail = requiredEnvironment("PHASE13_NON_ADMIN_EMAIL");
const nonAdminPassword = requiredEnvironment("PHASE13_NON_ADMIN_PASSWORD");

if (failures.length) process.exit(1);

const [adminToken, nonAdminToken] = await Promise.all([
  signIn("Akun admin", adminEmail, adminPassword, supabaseUrl, anonKey),
  signIn("Akun non-admin", nonAdminEmail, nonAdminPassword, supabaseUrl, anonKey),
]);

if (!adminToken || !nonAdminToken || failures.length) process.exit(1);

const invalidToken = "phase13-invalid-access-token";
const protectedReads = [
  ["dashboard admin", "/api/admin/dashboard"],
  ["evidence UAT", "/api/admin/pilot-readiness"],
];

for (const [label, path] of protectedReads) {
  const anonymous = await requestJson(path);
  check(anonymous.status === 401, `${label}: akses anonim ditolak`, `HTTP ${anonymous.status}`);

  const invalid = await requestJson(path, { headers: bearer(invalidToken) });
  check(invalid.status === 403, `${label}: token tidak valid ditolak`, `HTTP ${invalid.status}`);

  const nonAdmin = await requestJson(path, { headers: bearer(nonAdminToken) });
  check(nonAdmin.status === 403, `${label}: role non-admin ditolak`, `HTTP ${nonAdmin.status}`);

  const admin = await requestJson(path, { headers: bearer(adminToken) });
  check(
    admin.status === 200 && admin.body?.success === true,
    `${label}: administrator sah dapat membaca`,
    `HTTP ${admin.status}`,
  );
}

const mutationPath = "/api/admin/pilot-readiness";
const mutationInit = {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: "{}",
};

const anonymousMutation = await requestJson(mutationPath, mutationInit);
check(
  anonymousMutation.status === 401,
  "mutasi admin: akses anonim ditolak sebelum validasi payload",
  `HTTP ${anonymousMutation.status}`,
);

const nonAdminMutation = await requestJson(mutationPath, {
  ...mutationInit,
  headers: { ...mutationInit.headers, ...bearer(nonAdminToken) },
});
check(
  nonAdminMutation.status === 403,
  "mutasi admin: role non-admin ditolak sebelum validasi payload",
  `HTTP ${nonAdminMutation.status}`,
);

const adminMutation = await requestJson(mutationPath, {
  ...mutationInit,
  headers: { ...mutationInit.headers, ...bearer(adminToken) },
});
check(
  adminMutation.status === 400 && adminMutation.body?.code === "INVALID_UAT_SCENARIO",
  "mutasi admin: administrator lolos otorisasi lalu payload kosong ditolak tanpa perubahan data",
  `HTTP ${adminMutation.status}, code=${adminMutation.body?.code || "missing"}`,
);

if (failures.length) {
  console.error(`\nPhase 13 access evidence gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 13 access evidence lulus terhadap ${baseUrl}.`);
console.log("Tidak ada payload mutasi valid yang dikirim dan tidak ada token atau kata sandi yang dicetak.");
