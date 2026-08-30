const baseUrl = (process.env.PHASE12_API_URL || "http://localhost:3001").replace(/\/$/, "");
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    console.log(`[PASS] ${name}`);
    return;
  }
  failures.push(`${name}: ${detail}`);
  console.error(`[FAIL] ${name} - ${detail}`);
}

async function request(path, init) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
}

const publicCatalog = await request("/api/catalog/modules?phase12=1", {
  headers: { "Cache-Control": "no-cache" },
});
check("public catalog remains available", publicCatalog.status === 200, `HTTP ${publicCatalog.status}`);

for (const [name, path, method, body, expected] of [
  ["pilot certification anonymous", "/api/admin/pilot-certification", "GET", undefined, [401, 403]],
  ["pilot certification mutation anonymous", "/api/admin/pilot-certification", "PATCH", "{}", [401, 403]],
  ["operational assurance anonymous", "/api/admin/operational-assurance", "GET", undefined, [401, 403]],
  ["operational assurance mutation anonymous", "/api/admin/operational-assurance", "PATCH", "{}", [401, 403]],
  ["pilot operations anonymous", "/api/admin/pilot-operations", "GET", undefined, [401, 403]],
  ["pilot operations mutation anonymous", "/api/admin/pilot-operations", "PATCH", "{}", [401, 403]],
  ["pilot monitoring watchdog anonymous", "/api/automation/pilot-monitoring", "GET", undefined, [403]],
  ["client operations anonymous", "/api/automation/client-operations", "GET", undefined, [403]],
  ["acquisition processor anonymous", "/api/automation/acquisition", "GET", undefined, [403]],
  ["event worker anonymous", "/api/events/process", "POST", "{}", [401, 403]],
]) {
  const response = await request(path, {
    method,
    body,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
  check(name, expected.includes(response.status), `HTTP ${response.status}`);
}

if (failures.length) {
  console.error(`\nPhase 12 smoke gate failed (${failures.length} check).`);
  process.exit(1);
}

console.log(`\nPhase 12 smoke gate passed against ${baseUrl}.`);
