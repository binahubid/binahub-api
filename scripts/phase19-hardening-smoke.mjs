import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE19_API_URL || "").trim().replace(/\/$/, "");
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
  email: required("PHASE19_ADMIN_EMAIL"),
  password: required("PHASE19_ADMIN_PASSWORD"),
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara", authError?.message || "");
if (!token || failures.length) process.exit(1);

try {
  const [anonymous, controlPlane] = await Promise.all([
    request("/api/admin/pilot-operations"),
    request("/api/admin/pilot-operations", token),
  ]);

  check(anonymous.response.status === 401, "control plane pilot menolak anonim", `HTTP ${anonymous.response.status}`);
  check(
    controlPlane.response.status === 200 && controlPlane.body?.success === true,
    "control plane pilot dapat dibaca admin",
    `HTTP ${controlPlane.response.status}`,
  );
  check(controlPlane.body?.phase10Ready === true, "skema pilot tersedia");

  const releases = Array.isArray(controlPlane.body?.releases) ? controlPlane.body.releases : [];
  const controls = Array.isArray(controlPlane.body?.controls) ? controlPlane.body.controls : [];
  check(
    releases.every((release) => Array.isArray(release.recipientEmails)
      && release.recipientCount === release.recipientEmails.length),
    "seluruh release mengekspos audience kanonis kepada admin",
    `${releases.length} release`,
  );
  check(
    releases.every((release) => !["approved", "scheduled"].includes(release.status) || release.recipientCount > 0),
    "tidak ada release aktif tanpa audience",
  );
  check(controls.length === 4, "empat runtime control tersedia", `${controls.length} control`);

  if (process.env.PHASE19_EXPECT_LOCKED !== "false") {
    const unsafe = controls.filter((control) => !["disabled", "dry_run"].includes(control.effectiveMode));
    check(unsafe.length === 0, "seluruh workflow tetap disabled atau dry-run", `${unsafe.length} tidak aman`);
    check(
      controls.length === 4 && controls.every((control) =>
        control.pilotMasterSwitchEnabled === false && control.liveMasterSwitchEnabled === false),
      "master switch pilot dan live tetap tertutup",
    );
  }
} finally {
  await supabase.auth.signOut({ scope: "local" });
}

if (failures.length) {
  console.error(`\nPhase 19 hardening smoke gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 19 hardening smoke lulus terhadap ${baseUrl}.`);
console.log("Runner bersifat read-only: tidak memanggil worker, tidak mengubah release, dan tidak mengirim outbound.");
