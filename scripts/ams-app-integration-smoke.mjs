import { createHmac, randomBytes } from "node:crypto";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const appApiUrl = String(process.env.AMS_INTEGRATION_APP_API_URL || "https://api.binahub.id").trim().replace(/\/$/, "");
const amsApiUrl = String(process.env.AMS_INTEGRATION_AMS_API_URL || process.env.AMS_API_URL || "https://binahub-platform-api-prl5.vercel.app").trim().replace(/\/$/, "");
const sharedSecret = String(process.env.AMS_INTEGRATION_SMOKE_SECRET || process.env.AMS_INTEGRATION_SECRET || "").trim();
const failures = [];

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function request(baseUrl, path, { method = "GET", body, signed = false } = {}) {
  const rawBody = body === undefined ? undefined : JSON.stringify(body);
  const headers = { "X-Request-ID": crypto.randomUUID() };
  if (rawBody !== undefined) headers["Content-Type"] = "application/json";
  if (signed) {
    const timestamp = Date.now().toString();
    headers["X-BinaHub-Timestamp"] = timestamp;
    headers["X-BinaHub-Signature"] = createHmac("sha256", sharedSecret).update(`${timestamp}.${rawBody || ""}`).digest("hex");
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: rawBody,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

check(/^https:\/\//i.test(appApiUrl), "target APP API memakai HTTPS");
check(/^https:\/\//i.test(amsApiUrl), "target AMS API memakai HTTPS");
if (failures.length) process.exit(1);

const [appHealth, amsHealth] = await Promise.all([
  request(appApiUrl, "/api/health"),
  request(amsApiUrl, "/api/health"),
]);
check(appHealth.response.status === 200, "health APP API tersedia", `HTTP ${appHealth.response.status}`);
check(amsHealth.response.status === 200, "health AMS API tersedia", `HTTP ${amsHealth.response.status}`);

const unsignedChecks = await Promise.all([
  request(appApiUrl, "/api/integrations/ams/assignments", { method: "POST", body: {} }),
  request(appApiUrl, "/api/integrations/ams/access-link", { method: "POST", body: {} }),
  request(appApiUrl, "/api/integrations/ams/programs", { method: "POST", body: {} }),
  request(amsApiUrl, "/api/integrations/app/associates/search", { method: "POST", body: {} }),
  request(amsApiUrl, "/api/integrations/app/assignments", { method: "POST", body: {} }),
]);
check(
  unsignedChecks.every(({ response }) => response.status === 401),
  "seluruh endpoint server-to-server menolak request tanpa tanda tangan",
  `${unsignedChecks.filter(({ response }) => response.status === 401).length}/${unsignedChecks.length}`,
);

const anonymousAdminChecks = await Promise.all([
  request(appApiUrl, "/api/integrations/ams/associates"),
  request(appApiUrl, "/api/integrations/ams/assignment-requests", {
    method: "POST",
    body: {
      programId: crypto.randomUUID(),
      moduleKey: "tbos",
      role: "Fasilitator T-BOS",
      associateIds: [crypto.randomUUID()],
    },
  }),
  request(amsApiUrl, "/api/admin/app-programs"),
]);
check(
  anonymousAdminChecks.every(({ response }) => response.status === 401),
  "endpoint admin integrasi menolak pengguna anonim",
  `${anonymousAdminChecks.filter(({ response }) => response.status === 401).length}/${anonymousAdminChecks.length}`,
);

const invalidSession = await request(appApiUrl, "/api/integrations/ams/session", {
  method: "POST",
  body: { ticket: randomBytes(32).toString("base64url") },
});
check(invalidSession.response.status === 401, "tiket masuk acak ditolak", `HTTP ${invalidSession.response.status}`);

if (sharedSecret) {
  const [signedInvalidAssignment, signedSearch, signedPrograms] = await Promise.all([
    request(appApiUrl, "/api/integrations/ams/assignments", { method: "POST", body: {}, signed: true }),
    request(amsApiUrl, "/api/integrations/app/associates/search", { method: "POST", body: { query: "", limit: 1 }, signed: true }),
    request(appApiUrl, "/api/integrations/ams/programs", { method: "POST", body: { requesterEmail: "admin@binahub.id" }, signed: true }),
  ]);
  check(
    signedInvalidAssignment.response.status === 400,
    "APP menerima tanda tangan bersama lalu memvalidasi payload",
    `HTTP ${signedInvalidAssignment.response.status}`,
  );
  check(
    signedSearch.response.status === 200 && signedSearch.payload?.success === true && Array.isArray(signedSearch.payload?.data),
    "AMS menerima tanda tangan bersama dan merespons pencarian aman",
    `HTTP ${signedSearch.response.status}`,
  );
  check(
    signedPrograms.response.status === 200 && signedPrograms.payload?.success === true && Array.isArray(signedPrograms.payload?.data?.programs),
    "AMS dapat membaca katalog program APP melalui HMAC",
    `HTTP ${signedPrograms.response.status}`,
  );
} else {
  console.log("[SKIP] verifikasi secret bersama; isi AMS_INTEGRATION_SMOKE_SECRET untuk menguji HMAC lintas deployment.");
}

if (failures.length) {
  console.error(`\nSmoke integrasi AMS–APP gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nSmoke integrasi AMS–APP lulus.`);
console.log("Runner read-only: tidak membuat assignment, akun, tiket valid, atau perubahan data bisnis.");
