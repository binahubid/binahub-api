import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const baseUrl = String(process.env.PHASE17_API_URL || "").trim().replace(/\/$/, "");
const confirmed = process.env.PHASE17_CONFIRM_DEFAULT_GOVERNANCE === "true";
const decisionActor = String(process.env.PHASE17_DECISION_ACTOR || "admin@binahub.id").trim().toLowerCase();
const templateVersion = "v1.0-review";
const decisionNote = "Disetujui sebagai konfigurasi default interim oleh decision actor end-to-end; CEO melakukan post-implementation review.";
const failures = [];

function check(condition, label, detail = "") {
  console.log(`[${condition ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures.push(label);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment ${name} belum tersedia.`);
  return value;
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function apiRequest(path, token, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error(`${path}: HTTP ${response.status} — ${body?.error || "respons tidak valid"}`);
  }
  return body;
}

async function saveIfChanged(label, current, desired, comparableKeys, save) {
  const unchanged = comparableKeys.every(([currentKey, desiredKey = currentKey]) => {
    const currentValue = current?.[currentKey] ?? null;
    const desiredValue = desired[desiredKey] ?? null;
    return Array.isArray(currentValue) || Array.isArray(desiredValue)
      ? sameArray(currentValue || [], desiredValue || [])
      : currentValue === desiredValue;
  });
  if (unchanged) {
    console.log(`[SKIP] ${label} sudah sesuai keputusan interim`);
    return;
  }
  await save();
  console.log(`[PASS] ${label} diterapkan`);
}

if (!confirmed) {
  throw new Error("Set PHASE17_CONFIRM_DEFAULT_GOVERNANCE=true untuk mengizinkan penerapan keputusan governance production.");
}
if (!/^https:\/\//i.test(baseUrl)) throw new Error("PHASE17_API_URL wajib berupa URL HTTPS.");
if (!/^[^\\\s@]+@[^\\\s@]+\.[^\\\s@]+$/.test(decisionActor)) {
  throw new Error("PHASE17_DECISION_ACTOR wajib berupa alamat email yang valid tanpa backslash.");
}

const supabase = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: required("PHASE17_ADMIN_EMAIL"),
  password: required("PHASE17_ADMIN_PASSWORD"),
});
if (authError || !authData.session?.access_token) {
  throw new Error(`Administrator tidak memperoleh sesi: ${authError?.message || "access token tidak tersedia"}`);
}
const token = authData.session.access_token;

try {
  const [settings, outreach] = await Promise.all([
    apiRequest("/api/admin/business-settings", token),
    apiRequest("/api/admin/outreach-templates", token),
  ]);

  const commercial = {
    action: "save_commercial_policy",
    minimumTransactionEnabled: true,
    minimumTransactionAmount: 15_000_000,
    belowThresholdAction: "approval_required",
    routeCatalogModuleId: null,
    currency: "IDR",
    proposalValidityDays: 14,
    allowAdminOverride: false,
    overrideRequiresNote: true,
  };
  await saveIfChanged(
    "kebijakan transaksi minimum Rp15.000.000",
    settings.commercialPolicy,
    commercial,
    [
      ["minimum_transaction_enabled", "minimumTransactionEnabled"],
      ["minimum_transaction_amount", "minimumTransactionAmount"],
      ["below_threshold_action", "belowThresholdAction"],
      ["currency", "currency"],
      ["proposal_validity_days", "proposalValidityDays"],
      ["allow_admin_override", "allowAdminOverride"],
      ["override_requires_note", "overrideRequiresNote"],
    ],
    () => apiRequest("/api/admin/business-settings", token, { method: "POST", body: JSON.stringify(commercial) }),
  );

  for (const assignment of settings.assignments || []) {
    const payload = {
      action: "save_governance_assignment",
      functionKey: assignment.function_key,
      ownerUserId: null,
      ownerEmail: decisionActor,
      backupUserId: null,
      backupEmail: null,
      escalationChannel: `email:${decisionActor}`,
      notes: "Single-owner interim. CEO menjadi post-implementation reviewer; backup akan ditetapkan ketika anggota tim berikutnya tersedia.",
      active: true,
    };
    await saveIfChanged(
      `owner ${assignment.label}`,
      assignment,
      payload,
      [
        ["owner_user_id", "ownerUserId"],
        ["owner_email", "ownerEmail"],
        ["backup_user_id", "backupUserId"],
        ["backup_email", "backupEmail"],
        ["escalation_channel", "escalationChannel"],
        ["notes", "notes"],
        ["active", "active"],
      ],
      () => apiRequest("/api/admin/business-settings", token, { method: "POST", body: JSON.stringify(payload) }),
    );
  }

  for (const rule of settings.delegations || []) {
    const payload = {
      action: "save_approval_delegation",
      approvalKey: rule.approval_key,
      primaryApproverUserId: null,
      primaryApproverEmail: decisionActor,
      delegateUserId: null,
      delegateEmail: null,
      validFrom: null,
      validUntil: null,
      maximumAmount: null,
      maximumDiscountPercent: null,
      conditions: "Decision actor end-to-end menjadi approver interim. Delegasi nonaktif; seluruh pengecualian tetap memerlukan keputusan manusia tercatat.",
      active: true,
    };
    await saveIfChanged(
      `approval ${rule.label}`,
      rule,
      payload,
      [
        ["primary_approver_user_id", "primaryApproverUserId"],
        ["primary_approver_email", "primaryApproverEmail"],
        ["delegate_user_id", "delegateUserId"],
        ["delegate_email", "delegateEmail"],
        ["valid_from", "validFrom"],
        ["valid_until", "validUntil"],
        ["maximum_amount", "maximumAmount"],
        ["maximum_discount_percent", "maximumDiscountPercent"],
        ["conditions", "conditions"],
        ["active", "active"],
      ],
      () => apiRequest("/api/admin/business-settings", token, { method: "POST", body: JSON.stringify(payload) }),
    );
  }

  for (const sla of settings.riskSlas || []) {
    const payload = {
      action: "save_risk_sla",
      severity: sla.severity,
      enabled: true,
      acknowledgmentMinutes: Number(sla.acknowledgment_minutes),
      initialReviewMinutes: Number(sla.initial_review_minutes),
      backupEscalationMinutes: Number(sla.backup_escalation_minutes),
      finalDecisionMinutes: Number(sla.final_decision_minutes),
      businessHoursOnly: true,
      timeZone: "Asia/Jakarta",
      escalationChannels: ["notification", "email"],
      ownerEmail: decisionActor,
      notes: "SLA default interim; backup belum ditetapkan. Pelanggaran tetap dicatat dan ditindaklanjuti decision actor.",
    };
    await saveIfChanged(
      `SLA risiko ${sla.label}`,
      sla,
      payload,
      [
        ["enabled", "enabled"],
        ["acknowledgment_minutes", "acknowledgmentMinutes"],
        ["initial_review_minutes", "initialReviewMinutes"],
        ["backup_escalation_minutes", "backupEscalationMinutes"],
        ["final_decision_minutes", "finalDecisionMinutes"],
        ["business_hours_only", "businessHoursOnly"],
        ["time_zone", "timeZone"],
        ["escalation_channels", "escalationChannels"],
        ["owner_email", "ownerEmail"],
        ["notes", "notes"],
      ],
      () => apiRequest("/api/admin/business-settings", token, { method: "POST", body: JSON.stringify(payload) }),
    );
  }

  for (const template of settings.documentTemplates || []) {
    if (!["proposal_finance_legal_clause", "invoice_finance_legal_clause"].includes(template.template_key)) continue;
    if (template.status === "approved" && template.approved_by === decisionActor) {
      console.log(`[SKIP] ${template.name} sudah approved oleh decision actor`);
      continue;
    }
    await apiRequest("/api/admin/business-settings", token, {
      method: "POST",
      body: JSON.stringify({
        action: "save_document_template",
        id: template.id,
        templateKey: template.template_key,
        documentType: template.document_type,
        name: template.name,
        locale: template.locale,
        version: template.version,
        status: "approved",
        bodyTemplate: template.body_template,
        variables: template.variables || [],
        reviewRequired: true,
        ownerEmail: decisionActor,
        approvalNote: `${decisionNote} Wording tetap dapat direvisi setelah review CEO atau penasihat pajak.`,
      }),
    });
    console.log(`[PASS] ${template.name} disetujui sebagai wording interim`);
  }

  const targetTemplates = (outreach.templates || []).filter((template) => (
    template.version === templateVersion && template.is_mock === false
  ));
  check(targetTemplates.length === 18, "18 template outreach target ditemukan", `ditemukan ${targetTemplates.length}`);
  if (targetTemplates.length !== 18) throw new Error("Template outreach target belum lengkap; hentikan approval.");

  for (const template of targetTemplates) {
    if (template.status === "approved" && template.approved_by === decisionActor) {
      console.log(`[SKIP] ${template.locale}:${template.template_key} sudah approved`);
      continue;
    }
    await apiRequest("/api/admin/outreach-templates", token, {
      method: "POST",
      body: JSON.stringify({
        id: template.id,
        templateKey: template.template_key,
        locale: template.locale,
        version: template.version,
        status: "approved",
        subjectTemplate: template.subject_template,
        htmlTemplate: template.html_template,
        owner: decisionActor,
        isMock: false,
        approvalNote: decisionNote,
      }),
    });
    console.log(`[PASS] ${template.locale}:${template.template_key} approved`);
  }

  const [verifiedSettings, verifiedOutreach] = await Promise.all([
    apiRequest("/api/admin/business-settings", token),
    apiRequest("/api/admin/outreach-templates", token),
  ]);
  const policy = verifiedSettings.commercialPolicy;
  check(
    policy?.minimum_transaction_enabled === true
      && Number(policy.minimum_transaction_amount) === 15_000_000
      && policy.below_threshold_action === "approval_required"
      && policy.allow_admin_override === false,
    "kebijakan komersial default terverifikasi",
  );
  check(
    verifiedSettings.assignments?.length === 7
      && verifiedSettings.assignments.every((item) => item.active && item.owner_email === decisionActor && !item.backup_email),
    "7 assignment memakai single-owner interim tanpa backup fiktif",
  );
  check(
    verifiedSettings.delegations?.length === 6
      && verifiedSettings.delegations.every((item) => item.active && item.primary_approver_email === decisionActor && !item.delegate_email),
    "6 approval rule aktif tanpa delegasi",
  );
  check(
    verifiedSettings.riskSlas?.length === 4
      && verifiedSettings.riskSlas.every((item) => item.enabled && item.owner_email === decisionActor),
    "4 SLA default aktif dan ber-owner",
  );
  check(
    verifiedSettings.documentTemplates?.filter((item) => (
      ["proposal_finance_legal_clause", "invoice_finance_legal_clause"].includes(item.template_key)
      && item.status === "approved"
      && item.approved_by === decisionActor
    )).length === 2,
    "2 wording finance/legal approved interim",
  );
  check(
    verifiedOutreach.templates?.filter((item) => (
      item.version === templateVersion
      && item.is_mock === false
      && item.status === "approved"
      && item.approved_by === decisionActor
    )).length === 18,
    "18 template outreach approved interim",
  );

  if (failures.length) throw new Error(`Verifikasi governance gagal (${failures.length} pemeriksaan).`);
  console.log("\nPhase 17 default governance berhasil diterapkan.");
  console.log(`Decision actor: ${decisionActor}`);
  console.log("Tidak ada workflow, outbound, release, atau pilot yang diaktifkan oleh runner ini.");
} finally {
  await supabase.auth.signOut();
}
