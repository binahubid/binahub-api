const baseUrl = (process.env.PHASE7_API_URL || "http://localhost:3001").replace(/\/$/, "");
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

const catalogResponse = await request("/api/catalog/modules?phase7=1", {
  headers: { "Cache-Control": "no-cache" },
});
check("public catalog HTTP 200", catalogResponse.status === 200, `HTTP ${catalogResponse.status}`);

const catalog = catalogResponse.ok ? await catalogResponse.json() : {};
const modules = Array.isArray(catalog.products)
  ? catalog.products.flatMap((product) => Array.isArray(product.modules) ? product.modules : [])
  : [];
check("public catalog contains official modules", modules.length > 0, "no modules returned");
check(
  "public catalog version",
  modules.every((module) => module.catalogVersion === "v1.0-public"),
  "a module is not v1.0-public",
);
check(
  "tax policy remains explicitly pending",
  catalog.policy?.pricesExcludeTax === null && catalog.policy?.taxPolicyFinalized === false,
  "deployed API still exposes the pre-0.11.1 policy contract",
);

for (const endpoint of [
  ["admin dashboard anonymous", "/api/admin/dashboard", "GET", undefined, [401, 403]],
  ["operations anonymous", "/api/automation/client-operations", "GET", undefined, [403]],
  ["acquisition anonymous", "/api/automation/acquisition", "GET", undefined, [403]],
  ["event worker anonymous", "/api/events/process", "POST", "{}", [401, 403]],
  ["Cal.com invalid signature", "/api/integrations/cal-com/webhook", "POST", "{}", [401]],
  ["Resend invalid signature", "/api/integrations/resend/webhook", "POST", "{}", [401]],
]) {
  const [name, path, method, body, expected] = endpoint;
  const response = await request(path, {
    method,
    body,
    headers: body ? { "Content-Type": "application/json" } : undefined,
  });
  check(name, expected.includes(response.status), `HTTP ${response.status}`);
}

const untrustedCors = await request("/api/catalog/modules", {
  headers: { Origin: "https://evil.example" },
});
check(
  "untrusted CORS origin omitted",
  !untrustedCors.headers.has("access-control-allow-origin"),
  `received ${untrustedCors.headers.get("access-control-allow-origin")}`,
);

const trustedCors = await request("/api/catalog/modules", {
  headers: { Origin: "https://app.binahub.id" },
});
check(
  "trusted CORS origin reflected",
  trustedCors.headers.get("access-control-allow-origin") === "https://app.binahub.id",
  `received ${trustedCors.headers.get("access-control-allow-origin")}`,
);

for (const header of [
  "content-security-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
  "x-frame-options",
]) {
  check(`security header ${header}`, catalogResponse.headers.has(header), "header missing");
}

if (failures.length) {
  console.error(`\nPhase 7 smoke gate failed (${failures.length} check).`);
  process.exit(1);
}

console.log(`\nPhase 7 smoke gate passed against ${baseUrl}.`);
