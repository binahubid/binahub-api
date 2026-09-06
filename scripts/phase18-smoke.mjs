import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE18_API_URL || "").trim().replace(/\/$/, "");
const failures = [];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment ${name} belum tersedia.`);
  return value;
}

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function request(path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

check(/^https:\/\//i.test(baseUrl), "target API memakai HTTPS");
if (failures.length) process.exit(1);

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: required("PHASE18_ADMIN_EMAIL"),
  password: required("PHASE18_ADMIN_PASSWORD"),
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara", authError?.message || "");
if (!token || failures.length) process.exit(1);

try {
  const [anonymous, invalidWorker, admin] = await Promise.all([
    request("/api/admin/lead-agent"),
    request("/api/automation/lead-discovery"),
    request("/api/admin/lead-agent", token),
  ]);
  check(anonymous.response.status === 401, "control AI Lead Agent menolak anonim", `HTTP ${anonymous.response.status}`);
  check(invalidWorker.response.status === 403, "worker discovery menolak pemanggil tanpa secret", `HTTP ${invalidWorker.response.status}`);
  check(admin.response.status === 200 && admin.body?.success === true, "administrator dapat membaca control AI Lead Agent");
  check(admin.body?.phase18Ready === true, "tabel audit Phase 18 tersedia");
  const serializedConfig = JSON.stringify(admin.body?.config || {});
  check(!serializedConfig.includes("APOLLO_API_KEY") && !serializedConfig.includes("HUNTER_API_KEY") && !serializedConfig.includes("LEAD_AGENT_SECRET"), "respons tidak mengekspos nama atau nilai secret");
  check(
    typeof admin.body?.config?.dryRun === "boolean"
      && typeof admin.body?.config?.providerCallsEnabled === "boolean"
      && Array.isArray(admin.body?.readiness?.blockers),
    "status pengaman dan blocker tersedia",
  );
  check(Array.isArray(admin.body?.runs) && Array.isArray(admin.body?.candidates), "audit run dan kandidat dapat dibaca");
  console.log(`\nStatus konfigurasi: ${admin.body?.readiness?.ready ? "siap untuk pratinjau" : "belum lengkap (aman terkunci)"}.`);
} finally {
  await supabase.auth.signOut();
}

if (failures.length) {
  console.error(`\nPhase 18 smoke gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}
console.log(`\nPhase 18 AI Lead Agent smoke lulus terhadap ${baseUrl}.`);
console.log("Runner tidak memanggil Apollo/Hunter, tidak membuat batch, tidak mempromosikan lead, dan tidak mengirim outbound.");
