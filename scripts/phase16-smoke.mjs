const baseUrl = (process.env.PHASE16_API_URL || "").replace(/\/$/, "");
if (!baseUrl.startsWith("https://")) {
  console.error("[FAIL] PHASE16_API_URL wajib berupa URL HTTPS production.");
  process.exit(1);
}

let failed = false;
async function expectStatus(label, path, expected) {
  try {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    const ok = expected.includes(response.status);
    console.log(`[${ok ? "PASS" : "FAIL"}] ${label} — HTTP ${response.status}`);
    if (!ok) failed = true;
  } catch (error) {
    failed = true;
    console.log(`[FAIL] ${label} — ${error instanceof Error ? error.message : "request gagal"}`);
  }
}

await expectStatus("admin form program menolak anonim", "/api/admin/program-questionnaires?programId=00000000-0000-0000-0000-000000000000", [401]);
await expectStatus("PDF respons menolak anonim", "/api/admin/program-questionnaires/export?questionnaireId=00000000-0000-0000-0000-000000000000", [401]);
await expectStatus("form peserta menolak anonim", "/api/client/program-questionnaires?kind=binainsight", [401]);
await expectStatus("akses program menangani ID tidak ditemukan tanpa server error", "/api/client/access?program=00000000-0000-0000-0000-000000000000", [404]);

if (failed) {
  console.error("\nPhase 16 smoke gate gagal.");
  process.exit(1);
}
console.log(`\nPhase 16 smoke gate lulus terhadap ${baseUrl}.`);
