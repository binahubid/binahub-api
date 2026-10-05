// Local, synthetic UI preview. Does not load credentials, access DB, or send mail.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/proposal-request-page.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const previewModule = { exports: {} };
new Function("module", "exports", "require", compiled)(previewModule, previewModule.exports, require);
const { proposalRequestPage } = previewModule.exports;
createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:4317");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  if (url.pathname === "/mobile") { response.end('<title>Mobile preview — local only</title><body style="margin:0;background:#e9edf3;display:grid;place-items:center;min-height:100vh"><iframe title="Mobile proposal request preview" src="/confirm" style="border:0;width:390px;height:844px"></iframe></body>'); return; }
  if (request.method === "POST") { await new Promise((resolve) => setTimeout(resolve, 4000)); response.end(proposalRequestPage({ state: "received" })); return; }
  response.end(proposalRequestPage({ state: url.pathname === "/received" ? "received" : "confirm", action: "/submit", locale: url.searchParams.get("locale") === "en" ? "en" : "id" }));
}).listen(4317, "127.0.0.1", () => console.info("Synthetic proposal preview: http://127.0.0.1:4317/mobile"));
