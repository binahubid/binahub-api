const baseUrl = String(process.env.PHASE14_API_URL || "").replace(/\/$/, "");
if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  console.error("Set PHASE14_API_URL ke origin HTTPS API yang sudah dideploy.");
  process.exit(1);
}

let failed = false;
function result(ok, label, detail = "") {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function jsonRequest(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

const catalog = await jsonRequest("/api/catalog/modules");
result(catalog.response.status === 200 && catalog.body.success === true, "katalog publik tersedia", `HTTP ${catalog.response.status}`);
result(Array.isArray(catalog.body.products), "payload katalog memiliki daftar produk");
const unsafeModule = (catalog.body.products || []).flatMap((product) => product.modules || []).find((module) => module.isMock === true || module.readinessStatus && module.readinessStatus !== "ready");
result(!unsafeModule, "payload publik tidak mengekspos modul mock/non-ready");

for (const [label, path] of [
  ["admin catalog anonymous", "/api/admin/catalog"],
  ["business settings anonymous", "/api/admin/business-settings"],
  ["questionnaire admin anonymous", "/api/admin/program-questionnaires?programId=00000000-0000-4000-8000-000000000001"],
  ["questionnaire client anonymous", "/api/client/program-questionnaires?kind=pre_test"],
]) {
  const probe = await jsonRequest(path);
  result([401, 403].includes(probe.response.status), label, `HTTP ${probe.response.status}`);
}

const importProbe = await jsonRequest("/api/admin/program-questionnaires/import", { method: "POST" });
result([401, 403].includes(importProbe.response.status), "impor dokumen anonymous", `HTTP ${importProbe.response.status}`);

if (failed) {
  console.error("\nPhase 14 smoke gate gagal.");
  process.exit(1);
}
console.log(`\nPhase 14 smoke gate passed against ${baseUrl}.`);
