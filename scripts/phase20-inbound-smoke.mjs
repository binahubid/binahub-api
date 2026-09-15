import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE20_API_URL || "").trim().replace(/\/$/, "");
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
async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(30_000) });
  return { response, body: await response.json().catch(() => null) };
}

check(/^https:\/\//i.test(baseUrl), "target API memakai HTTPS");
if (failures.length) process.exit(1);

const eventPayload = {
  eventType: "landing_view",
  routePath: "/phase20-smoke",
  attribution: { utmSource: "phase20_smoke", utmMedium: "test", utmCampaign: "inbound_journey" },
};
const publicWrite = await request("/api/acquisition/journey", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(eventPayload),
});
check(publicWrite.response.status === 201 && publicWrite.body?.success === true, "tracker publik menerima event anonim", `HTTP ${publicWrite.response.status}`);
const journeyId = publicWrite.body?.journeyId;
check(typeof journeyId === "string" && /^[0-9a-f-]{36}$/i.test(journeyId || ""), "tracker mengembalikan journey opaque");

if (journeyId) {
  const secondWrite = await request("/api/acquisition/journey", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...eventPayload, journeyId, eventType: "catalog_module_selected", moduleCodes: ["BI-PUBLIC"] }),
  });
  check(secondWrite.response.status === 201 && secondWrite.body?.journeyId === journeyId, "event berikutnya memakai journey yang sama");
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false, autoRefreshToken: false } });
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: required("PHASE20_ADMIN_EMAIL"), password: required("PHASE20_ADMIN_PASSWORD"),
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara", authError?.message || "");
if (token) {
  const [anonymous, admin] = await Promise.all([
    request("/api/admin/acquisition/attribution"),
    request("/api/admin/acquisition/attribution", { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  check(anonymous.response.status === 401, "dashboard attribution menolak anonim", `HTTP ${anonymous.response.status}`);
  check(admin.response.status === 200 && admin.body?.phase20Ready === true, "administrator dapat membaca funnel attribution");
  check((admin.body?.journeys || []).some((journey) => journey.id === journeyId), "journey smoke muncul pada dashboard admin");
  check(!JSON.stringify(admin.body).includes("@"), "respons funnel tidak mengekspos email");

  const [manualAnonymous, manualAdmin, invalidPublicLink] = await Promise.all([
    request("/api/admin/acquisition/outbound-link"),
    request("/api/admin/acquisition/outbound-link", { headers: { Authorization: `Bearer ${token}` } }),
    request("/api/acquisition/c/bh20.invalid.invalid"),
  ]);
  check(manualAnonymous.response.status === 401, "kontrol tautan Apollo manual menolak anonim", `HTTP ${manualAnonymous.response.status}`);
  check(manualAdmin.response.status === 200 && manualAdmin.body?.phase20Part2Ready === true, "administrator dapat membaca kontrol tautan Phase 20.2");
  check(manualAdmin.body?.signingReady === true, "secret penandatangan tautan tersedia tanpa diekspos");
  check(invalidPublicLink.response.status === 404, "token kampanye invalid tidak membocorkan data", `HTTP ${invalidPublicLink.response.status}`);
}
await supabase.auth.signOut();

if (failures.length) {
  console.error(`\nPhase 20.1 smoke gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}
console.log(`\nPhase 20 unified funnel smoke lulus terhadap ${baseUrl}.`);
console.log("Runner hanya menulis dua event funnel anonim; tidak membuat tautan UAT, tidak mengirim email, tidak mempromosikan lead, dan tidak mengaktifkan workflow.");
