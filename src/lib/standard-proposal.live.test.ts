import { expect, it, vi } from "vitest";

// Opt-in, read-only audit. Never imports the proposal sender or writes to DB.
it.skipIf(!process.env.STANDARD_PROPOSAL_AUDIT_ID)("audits catalog selection against a real assessment without sending email", async () => {
  const { loadEnvConfig } = await import("@next/env");
  vi.stubEnv("NODE_ENV", "production");
  loadEnvConfig(process.cwd());
  vi.unstubAllEnvs();
  const { createClient } = await import("@supabase/supabase-js");
  const { selectStandardCatalogModules } = await import("./ai-service");
  const { isAutoSendableStandardModule } = await import("./standard-catalog-policy");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const assessment = await db.from("assessments").select("form_data,scores,recommendations,category").eq("id", process.env.STANDARD_PROPOSAL_AUDIT_ID!).single();
  const catalog = await db.from("catalog_modules").select("module_code,name,standard_scope,deliverables,duration_label,pricing_unit,base_price,catalog_version,metadata").eq("active", true).eq("readiness_status", "ready").eq("is_mock", false);
  expect(assessment.error).toBeNull();
  expect(catalog.error).toBeNull();
  const form = assessment.data!.form_data;
  const candidates = (catalog.data || []).filter(isAutoSendableStandardModule).map((module) => {
    const copy = module.metadata?.localized?.[form.locale === "en" ? "en" : "id"] || {};
    return { code: module.module_code, name: copy.name || module.name, summary: copy.summary || "", scope: (copy.contentOutline || [module.standard_scope]).join("; "), objectives: (copy.learningObjectives || []).slice(0, 4), duration: module.duration_label || "", serviceBrand: copy.serviceBrand || "" };
  });
  const started = Date.now();
  const selected = await selectStandardCatalogModules({ locale: form.locale === "en" ? "en" : "id", challenge: form.challenge || "", target: form.target || "", scores: assessment.data!.scores, category: assessment.data!.category || "", recommendations: assessment.data!.recommendations || [], candidates });
  console.info("Read-only proposal audit", { elapsedMs: Date.now() - started, availableStandardModules: candidates.length, selectedCodes: selected.moduleCodes });
  expect(selected.moduleCodes.every((code) => candidates.some((module) => module.code === code))).toBe(true);
}, 75_000);
