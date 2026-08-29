import type { createServerSupabase } from "@/lib/supabase";

type DatabaseClient = ReturnType<typeof createServerSupabase>;

export const REQUIRED_OUTREACH_TEMPLATE_KEYS = [
  "inquiry_follow_up_1",
  "inquiry_follow_up_2",
  "inquiry_follow_up_3",
  "assessment_result_follow_up_1",
  "assessment_result_follow_up_2",
  "assessment_result_follow_up_3",
  "assessment_proposal_follow_up_1",
  "assessment_proposal_follow_up_2",
  "assessment_proposal_follow_up_3",
] as const;
const REQUIRED_OUTREACH_LOCALES = ["id", "en"] as const;

export type ApprovedOutreachTemplate = {
  templateKey: string;
  locale: "id" | "en";
  version: string;
  subject: string;
  html: string;
  owner: string | null;
  approvedBy: string;
  approvedAt: string;
};

export class ApprovedOutreachTemplateRequiredError extends Error {
  constructor(templateKey: string) {
    super(`Template ${templateKey} belum memiliki versi non-mock yang disetujui.`);
    this.name = "ApprovedOutreachTemplateRequiredError";
  }
}

export async function loadApprovedOutreachTemplate(
  db: DatabaseClient,
  templateKey: string,
  locale: "id" | "en" = "id",
): Promise<ApprovedOutreachTemplate | null> {
  const { data, error } = await db
    .from("outreach_templates")
    .select("template_key, locale, version, subject_template, html_template, owner, approved_by, approved_at")
    .eq("template_key", templateKey)
    .eq("locale", locale)
    .eq("status", "approved")
    .eq("is_mock", false)
    .maybeSingle();

  if (error) throw new Error(`Gagal memuat template follow-up: ${error.message}`);
  if (!data?.approved_by || !data.approved_at) return null;

  return {
    templateKey: data.template_key,
    locale: data.locale as "id" | "en",
    version: data.version,
    subject: data.subject_template,
    html: data.html_template,
    owner: data.owner || null,
    approvedBy: data.approved_by,
    approvedAt: data.approved_at,
  };
}

export async function requireApprovedOutreachTemplate(
  db: DatabaseClient,
  templateKey: string,
  locale: "id" | "en" = "id",
) {
  const template = await loadApprovedOutreachTemplate(db, templateKey, locale);
  if (!template) throw new ApprovedOutreachTemplateRequiredError(templateKey);
  return template;
}

export async function isOutboundAutomationActive(db: DatabaseClient) {
  const [{ data, error }, { data: approvedTemplates, error: templateError }] = await Promise.all([
    db.from("business_rule_sets")
      .select("version, rules")
      .eq("status", "active")
      .eq("is_mock", false)
      .maybeSingle(),
    db.from("outreach_templates")
      .select("template_key, locale")
      .eq("status", "approved")
      .eq("is_mock", false)
      .in("template_key", [...REQUIRED_OUTREACH_TEMPLATE_KEYS]),
  ]);

  if (error) throw new Error(`Gagal membaca activation gate: ${error.message}`);
  if (templateError) throw new Error(`Gagal membaca kesiapan template: ${templateError.message}`);
  const rules = data?.rules && typeof data.rules === "object" && !Array.isArray(data.rules)
    ? data.rules as Record<string, unknown>
    : {};
  const activation = rules.activation && typeof rules.activation === "object" && !Array.isArray(rules.activation)
    ? rules.activation as Record<string, unknown>
    : {};

  const approvedKeys = new Set((approvedTemplates || []).map((item) => `${item.locale}:${item.template_key}`));
  const requiredTemplates = REQUIRED_OUTREACH_LOCALES.flatMap((locale) =>
    REQUIRED_OUTREACH_TEMPLATE_KEYS.map((key) => `${locale}:${key}`)
  );
  const missingTemplateKeys = requiredTemplates.filter((key) => !approvedKeys.has(key));
  const businessRulesActive = Boolean(data?.version && activation.outboundAutomationEnabled === true);
  return {
    active: businessRulesActive && missingTemplateKeys.length === 0,
    businessRulesActive,
    templatesReady: missingTemplateKeys.length === 0,
    missingTemplateKeys,
    ruleVersion: data?.version || null,
  };
}
