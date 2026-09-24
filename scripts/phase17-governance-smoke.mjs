import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE17_API_URL || "").trim().replace(/\/$/, "");
const decisionActor = String(process.env.PHASE17_DECISION_ACTOR || "admin@binahub.id").trim().toLowerCase();
const failures = [];
const requiredOutreachKeys = [
  "inquiry_follow_up_1", "inquiry_follow_up_2", "inquiry_follow_up_3",
  "assessment_result_follow_up_1", "assessment_result_follow_up_2", "assessment_result_follow_up_3",
  "assessment_proposal_follow_up_1",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment ${name} belum tersedia.`);
  return value;
}

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

async function request(path, token, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
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
  email: required("PHASE17_ADMIN_EMAIL"),
  password: required("PHASE17_ADMIN_PASSWORD"),
});
const token = authData.session?.access_token || "";
check(!authError && Boolean(token), "administrator memperoleh sesi sementara", authError?.message || "");
if (!token || failures.length) process.exit(1);

try {
  const anonymous = await request("/api/admin/business-settings");
  check(anonymous.response.status === 401, "business settings menolak akses anonim", `HTTP ${anonymous.response.status}`);
  const anonymousReconciliation = await request("/api/admin/business-rules/reconcile", "", {
    method: "POST",
    body: JSON.stringify({
      action: "reconcile_phase17_defaults",
      confirmation: "ALIGN_PHASE17_DEFAULTS",
    }),
  });
  check(anonymousReconciliation.response.status === 401, "penyelarasan Business Rules menolak akses anonim", `HTTP ${anonymousReconciliation.response.status}`);

  const [settings, outreach, businessRules, operations] = await Promise.all([
    request("/api/admin/business-settings", token),
    request("/api/admin/outreach-templates", token),
    request("/api/admin/business-rules", token),
    request("/api/admin/pilot-operations", token),
  ]);
  check(settings.response.status === 200 && settings.body?.success === true, "business settings dapat dibaca admin");
  check(outreach.response.status === 200 && outreach.body?.success === true, "outreach templates dapat dibaca admin");
  check(businessRules.response.status === 200 && businessRules.body?.success === true, "Business Rules dapat dibaca admin");
  check(operations.response.status === 200 && operations.body?.success === true, "control plane dapat dibaca admin");

  const policy = settings.body?.commercialPolicy;
  check(
    policy?.minimum_transaction_enabled === true
      && Number(policy.minimum_transaction_amount) === 15_000_000
      && policy.below_threshold_action === "approval_required"
      && policy.allow_admin_override === false,
    "transaksi minimum dan human gate sesuai default",
  );
  check(
    settings.body?.assignments?.length === 7
      && settings.body.assignments.every((item) => item.active && item.owner_email === decisionActor && !item.backup_email),
    "seluruh fungsi memiliki owner interim tanpa backup fiktif",
  );
  check(
    settings.body?.delegations?.length === 6
      && settings.body.delegations.every((item) => item.active && item.primary_approver_email === decisionActor && !item.delegate_email),
    "seluruh rule memiliki approver interim dan delegasi nonaktif",
  );
  check(
    settings.body?.riskSlas?.length === 4
      && settings.body.riskSlas.every((item) => item.enabled && item.owner_email === decisionActor),
    "empat SLA default aktif dan ber-owner",
  );
  check(
    settings.body?.documentTemplates?.filter((item) => (
      ["proposal_finance_legal_clause", "invoice_finance_legal_clause"].includes(item.template_key)
      && item.status === "approved"
      && item.approved_by === decisionActor
    )).length === 2,
    "wording proposal dan invoice approved interim",
  );
  const approvedOutreachKeys = new Set((outreach.body?.templates || [])
    .filter((item) => item.is_mock === false && item.status === "approved" && item.approved_by)
    .map((item) => `${item.locale}:${item.template_key}`));
  const requiredApprovedKeys = ["id", "en"].flatMap((locale) => requiredOutreachKeys.map((key) => `${locale}:${key}`));
  check(
    requiredApprovedKeys.every((key) => approvedOutreachKeys.has(key)),
    "14 template follow-up wajib memiliki versi approved non-mock",
  );
  const activation = businessRules.body?.selectedRuleSet?.rules?.activation;
  check(
    businessRules.body?.selectedRuleSet?.version === "v1.1-default-governance"
      && businessRules.body?.selectedRuleSet?.status === "active"
      && businessRules.body?.selectedRuleSet?.is_mock === false
      && activation?.outboundAutomationEnabled === true
      && Array.isArray(activation?.blockers)
      && activation.blockers.length === 0,
    "Business Rules aktif selaras dengan keputusan Phase 17",
  );

  const controls = operations.body?.controls || [];
  check(controls.length === 4, "empat runtime control tersedia");
  check(
    controls.every((item) => ["dry_run", "disabled"].includes(item.effectiveMode)),
    "seluruh workflow tetap dry-run atau disabled",
  );
  check(
    controls.every((item) => item.pilotMasterSwitchEnabled === false && item.liveMasterSwitchEnabled === false),
    "master switch pilot dan live tetap tertutup",
  );
} finally {
  await supabase.auth.signOut();
}

if (failures.length) {
  console.error(`\nPhase 17 governance smoke gagal (${failures.length} pemeriksaan).`);
  process.exit(1);
}

console.log(`\nPhase 17 governance smoke lulus terhadap ${baseUrl}.`);
console.log("Governance default dan izin policy sudah tercatat; runtime, environment, release, dan master switch tetap terkunci.");
