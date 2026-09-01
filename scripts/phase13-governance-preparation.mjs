import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const confirmed = process.env.PHASE13_CONFIRM_GOVERNANCE_PREP === "true";
const technicalOwner = process.env.PHASE13_TECHNICAL_OWNER?.trim().toLowerCase() || "admin@binahub.id";
const templateOwner = process.env.PHASE13_TEMPLATE_OWNER?.trim().toLowerCase() || technicalOwner;
const bookingUrl = (process.env.CALCOM_BOOKING_URL || "").trim().replace(/\/$/, "");
const templateVersion = "v1.0-review";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Environment ${name} belum tersedia.`);
  return value;
}

function validateOwner(value, label) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${label} wajib berupa alamat email owner yang valid.`);
  }
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function emailHtml(locale, paragraphs, ctaLabel) {
  const greeting = locale === "id" ? "Yth. Bapak/Ibu {{name}}," : "Hello {{name}},";
  const automatic = locale === "id"
    ? "Email ini dikirim otomatis dan tidak dipantau. Gunakan tombol di atas jika Anda ingin melanjutkan pembahasan."
    : "This automated email is not monitored. Please use the button above if you would like to continue the discussion.";
  return `<div style="max-width:600px;margin:0 auto;padding:32px 24px;font-family:Arial,sans-serif;color:#10213f;line-height:1.65;">
  <p style="margin:0 0 20px;font-size:16px;">${greeting}</p>
  ${paragraphs.map((paragraph) => `<p style="margin:0 0 16px;font-size:15px;">${paragraph}</p>`).join("\n  ")}
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 24px;"><tr><td bgcolor="#0b2c6b">
    <a href="${escapeAttribute(bookingUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:.01em;">${ctaLabel}</a>
  </td></tr></table>
  <p style="margin:0;color:#64748b;font-size:12px;line-height:1.55;">${automatic}</p>
</div>`;
}

const copy = [
  {
    key: "inquiry_follow_up_1",
    id: {
      subject: "Menindaklanjuti kebutuhan {{company}}",
      paragraphs: [
        "Terima kasih telah menyampaikan kebutuhan {{company}} kepada BinaHub.",
        "Tim kami dapat membantu memetakan konteks awal, ruang lingkup, dan langkah yang paling relevan melalui konsultasi singkat.",
      ],
      cta: "Jadwalkan konsultasi awal",
    },
    en: {
      subject: "Following up on {{company}}'s needs",
      paragraphs: [
        "Thank you for sharing {{company}}'s needs with BinaHub.",
        "Our team can help clarify the initial context, scope, and most relevant next step through a short consultation.",
      ],
      cta: "Schedule an initial consultation",
    },
  },
  {
    key: "inquiry_follow_up_2",
    id: {
      subject: "Apakah kebutuhan {{company}} masih menjadi prioritas?",
      paragraphs: [
        "Kami menindaklanjuti kebutuhan yang sebelumnya disampaikan oleh {{company}}.",
        "Jika kebutuhan tersebut masih menjadi prioritas, pilih waktu yang nyaman agar tim kami dapat membantu merapikan tujuan dan ruang lingkup pembahasannya.",
      ],
      cta: "Pilih jadwal konsultasi",
    },
    en: {
      subject: "Is this still a priority for {{company}}?",
      paragraphs: [
        "We are following up on the needs previously shared by {{company}}.",
        "If this is still a priority, choose a convenient time so our team can help clarify the objective and scope of the discussion.",
      ],
      cta: "Choose a consultation time",
    },
  },
  {
    key: "inquiry_follow_up_3",
    id: {
      subject: "Konfirmasi akhir tindak lanjut {{company}}",
      paragraphs: [
        "Ini merupakan konfirmasi terakhir untuk kebutuhan {{company}} yang pernah disampaikan kepada BinaHub.",
        "Kami akan menutup antrean tindak lanjut setelah pesan ini. Apabila pembahasan ingin dilanjutkan, jadwal konsultasi tetap dapat dipilih melalui tombol berikut.",
      ],
      cta: "Lanjutkan pembahasan",
    },
    en: {
      subject: "Final follow-up for {{company}}",
      paragraphs: [
        "This is our final follow-up regarding the needs {{company}} previously shared with BinaHub.",
        "We will close the follow-up queue after this message. If you would like to continue, you can still choose a consultation time below.",
      ],
      cta: "Continue the discussion",
    },
  },
  {
    key: "assessment_result_follow_up_1",
    id: {
      subject: "Langkah berikutnya setelah diagnostik BinaInsight {{company}}",
      paragraphs: [
        "Laporan diagnostik BinaInsight untuk {{company}} telah tersedia sebagai rujukan awal.",
        "Melalui sesi singkat, tim BinaHub dapat membantu menjelaskan temuan utama dan memilih prioritas yang paling relevan untuk ditindaklanjuti.",
      ],
      cta: "Bahas hasil diagnostik",
    },
    en: {
      subject: "Next steps after {{company}}'s BinaInsight diagnostic",
      paragraphs: [
        "The BinaInsight diagnostic report for {{company}} is available as an initial reference.",
        "In a short session, the BinaHub team can help clarify the main findings and identify the most relevant priorities for further action.",
      ],
      cta: "Discuss the diagnostic result",
    },
  },
  {
    key: "assessment_result_follow_up_2",
    id: {
      subject: "Membahas prioritas transformasi {{company}}",
      paragraphs: [
        "Hasil diagnostik BinaInsight dapat digunakan untuk menyaring prioritas transformasi yang paling penting bagi {{company}}.",
        "Pilih waktu konsultasi apabila Anda ingin menguji konteks temuan, urutan prioritas, dan alternatif langkah berikutnya bersama tim kami.",
      ],
      cta: "Pilih waktu pembahasan",
    },
    en: {
      subject: "Discussing {{company}}'s transformation priorities",
      paragraphs: [
        "The BinaInsight diagnostic can help narrow down the most important transformation priorities for {{company}}.",
        "Choose a consultation time if you would like to examine the findings, priority sequence, and possible next steps with our team.",
      ],
      cta: "Choose a discussion time",
    },
  },
  {
    key: "assessment_result_follow_up_3",
    id: {
      subject: "Konfirmasi pembahasan hasil BinaInsight {{company}}",
      paragraphs: [
        "Ini merupakan tindak lanjut terakhir kami atas hasil diagnostik BinaInsight {{company}}.",
        "Kami akan menjeda rangkaian follow-up setelah pesan ini. Jika hasil tersebut ingin dibahas kemudian, jadwal konsultasi tetap tersedia melalui tombol berikut.",
      ],
      cta: "Jadwalkan pembahasan",
    },
    en: {
      subject: "Final follow-up on {{company}}'s BinaInsight result",
      paragraphs: [
        "This is our final follow-up regarding {{company}}'s BinaInsight diagnostic result.",
        "We will pause the follow-up sequence after this message. If you would like to discuss the result later, consultation times remain available below.",
      ],
      cta: "Schedule a discussion",
    },
  },
  {
    key: "assessment_proposal_follow_up_1",
    id: {
      subject: "Tindak lanjut proposal {{company}}",
      paragraphs: [
        "Proposal awal untuk {{company}} telah dikirim sebagai bahan peninjauan.",
        "Jika diperlukan, tim kami dapat membantu menjelaskan ruang lingkup, asumsi, dan bagian yang perlu diselaraskan sebelum keputusan berikutnya.",
      ],
      cta: "Jadwalkan pembahasan proposal",
    },
    en: {
      subject: "Following up on {{company}}'s proposal",
      paragraphs: [
        "The initial proposal for {{company}} has been sent for review.",
        "If helpful, our team can clarify the scope, assumptions, and any areas that need alignment before the next decision.",
      ],
      cta: "Schedule a proposal discussion",
    },
  },
  {
    key: "assessment_proposal_follow_up_2",
    id: {
      subject: "Pembahasan ruang lingkup proposal {{company}}",
      paragraphs: [
        "Kami ingin memastikan proposal {{company}} dapat ditinjau dengan konteks yang memadai.",
        "Jadwalkan sesi apabila Anda ingin membahas ruang lingkup, jadwal, asumsi komersial, atau penyesuaian yang masih diperlukan.",
      ],
      cta: "Pilih waktu pembahasan",
    },
    en: {
      subject: "Reviewing the scope of {{company}}'s proposal",
      paragraphs: [
        "We want to ensure that {{company}}'s proposal can be reviewed with sufficient context.",
        "Schedule a session if you would like to discuss the scope, timeline, commercial assumptions, or any remaining adjustments.",
      ],
      cta: "Choose a discussion time",
    },
  },
  {
    key: "assessment_proposal_follow_up_3",
    id: {
      subject: "Konfirmasi keputusan proposal {{company}}",
      paragraphs: [
        "Ini merupakan tindak lanjut terakhir kami atas proposal {{company}}.",
        "Jika pembahasan ingin dilanjutkan, pilih jadwal yang tersedia. Jika belum menjadi prioritas, antrean follow-up akan kami tutup setelah pesan ini.",
      ],
      cta: "Lanjutkan pembahasan proposal",
    },
    en: {
      subject: "Confirming the decision on {{company}}'s proposal",
      paragraphs: [
        "This is our final follow-up regarding {{company}}'s proposal.",
        "If you would like to continue the discussion, choose an available time. Otherwise, we will close the follow-up queue after this message.",
      ],
      cta: "Continue the proposal discussion",
    },
  },
];

if (!confirmed) throw new Error("Set PHASE13_CONFIRM_GOVERNANCE_PREP=true untuk mengizinkan persiapan governance production.");
validateOwner(technicalOwner, "PHASE13_TECHNICAL_OWNER");
validateOwner(templateOwner, "PHASE13_TEMPLATE_OWNER");
if (!/^https:\/\//i.test(bookingUrl)) throw new Error("CALCOM_BOOKING_URL wajib berupa URL HTTPS.");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
if (!supabaseUrl) throw new Error("Supabase URL belum tersedia.");
const db = createClient(supabaseUrl, required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [{ data: policies, error: policyReadError }, { data: controls, error: controlReadError }] = await Promise.all([
  db.from("automation_monitoring_policies")
    .select("workflow_key,lookback_hours,minimum_runs,maximum_failure_rate_percent,stale_running_minutes,maximum_consecutive_failures,enabled,owner,is_mock")
    .order("workflow_key"),
  db.from("automation_runtime_controls")
    .select("workflow_key,requested_mode,maximum_items_per_run,owner,rollback_plan")
    .order("workflow_key"),
]);
if (policyReadError) throw new Error(policyReadError.message);
if (controlReadError) throw new Error(controlReadError.message);
if ((policies || []).length !== 4) throw new Error(`Diharapkan 4 monitoring policy, ditemukan ${(policies || []).length}.`);
if ((controls || []).length !== 4) throw new Error(`Diharapkan 4 runtime control, ditemukan ${(controls || []).length}.`);

for (const policy of policies || []) {
  if (!policy.is_mock && policy.enabled && policy.owner === technicalOwner) {
    console.log(`[SKIP] ${policy.workflow_key} sudah real dan dimiliki ${technicalOwner}`);
    continue;
  }
  const { error } = await db.rpc("save_automation_monitoring_policy", {
    p_workflow_key: policy.workflow_key,
    p_actor: technicalOwner,
    p_lookback_hours: policy.lookback_hours,
    p_minimum_runs: policy.minimum_runs,
    p_maximum_failure_rate_percent: policy.maximum_failure_rate_percent,
    p_stale_running_minutes: policy.stale_running_minutes,
    p_maximum_consecutive_failures: policy.maximum_consecutive_failures,
    p_enabled: true,
    p_owner: technicalOwner,
    p_is_mock: false,
  });
  if (error) throw new Error(`${policy.workflow_key}: ${error.message}`);
  console.log(`[PASS] ${policy.workflow_key} menjadi policy real ber-owner`);
}

for (const control of controls || []) {
  if (control.requested_mode !== "dry_run") {
    throw new Error(`${control.workflow_key} tidak aman untuk ownership preparation: requested_mode=${control.requested_mode}.`);
  }
  if (control.owner === technicalOwner) {
    console.log(`[SKIP] ${control.workflow_key} runtime control sudah dimiliki ${technicalOwner}`);
    continue;
  }
  const { error } = await db.rpc("set_automation_runtime_control", {
    p_workflow_key: control.workflow_key,
    p_actor: technicalOwner,
    p_requested_mode: "dry_run",
    p_maximum_items_per_run: control.maximum_items_per_run,
    p_owner: technicalOwner,
    p_release_id: null,
    p_human_approved: false,
    p_approval_note: null,
    p_rollback_plan: control.rollback_plan || null,
    p_kill_switch_reason: null,
  });
  if (error) throw new Error(`${control.workflow_key} runtime control: ${error.message}`);
  console.log(`[PASS] ${control.workflow_key} runtime control tetap dry-run dan memiliki technical owner`);
}

for (const template of copy) {
  for (const locale of ["id", "en"]) {
    const content = template[locale];
    const { data: existing, error: existingError } = await db.from("outreach_templates")
      .select("id,status")
      .eq("template_key", template.key)
      .eq("locale", locale)
      .eq("version", templateVersion)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.status === "approved") {
      console.log(`[SKIP] ${locale}:${template.key} sudah approved dan tidak akan diturunkan`);
      continue;
    }
    const html = emailHtml(locale, content.paragraphs, content.cta);
    if (/balas email|reply to (this|the) email/i.test(html)) {
      throw new Error(`${locale}:${template.key} masih mengandung instruksi reply.`);
    }
    const { error } = await db.rpc("save_outreach_template", {
      p_id: existing?.id || null,
      p_template_key: template.key,
      p_locale: locale,
      p_version: templateVersion,
      p_status: "draft",
      p_subject_template: content.subject,
      p_html_template: html,
      p_owner: templateOwner,
      p_is_mock: false,
      p_actor: templateOwner,
      p_approval_note: null,
    });
    if (error) throw new Error(`${locale}:${template.key}: ${error.message}`);
    console.log(`[PASS] ${locale}:${template.key} disimpan sebagai draft non-mock ${templateVersion}`);
  }
}

const [policyVerification, controlVerification, templateVerification] = await Promise.all([
  db.from("automation_monitoring_policies").select("workflow_key,owner,is_mock,enabled"),
  db.from("automation_runtime_controls").select("workflow_key,requested_mode,owner,pilot_release_id"),
  db.from("outreach_templates").select("template_key,locale,status,is_mock,owner,approved_by,approved_at")
    .eq("version", templateVersion),
]);
if (policyVerification.error) throw new Error(policyVerification.error.message);
if (controlVerification.error) throw new Error(controlVerification.error.message);
if (templateVerification.error) throw new Error(templateVerification.error.message);

const realPolicies = (policyVerification.data || []).filter((item) => !item.is_mock && item.enabled && item.owner === technicalOwner);
const ownedDryRunControls = (controlVerification.data || []).filter((item) => item.requested_mode === "dry_run" && item.owner === technicalOwner && !item.pilot_release_id);
const reviewTemplates = (templateVerification.data || []).filter((item) => !item.is_mock && item.status === "draft" && item.owner === templateOwner && !item.approved_by && !item.approved_at);
if (realPolicies.length !== 4) throw new Error(`Verifikasi policy gagal: ${realPolicies.length}/4 real ber-owner.`);
if (ownedDryRunControls.length !== 4) throw new Error(`Verifikasi runtime control gagal: ${ownedDryRunControls.length}/4 dry-run ber-owner.`);
if (reviewTemplates.length !== 18) throw new Error(`Verifikasi template gagal: ${reviewTemplates.length}/18 draft review.`);

console.log("\nPhase 13 governance preparation selesai.");
console.log(`Monitoring policy: ${realPolicies.length}/4 real, enabled, owner=${technicalOwner}`);
console.log(`Runtime control: ${ownedDryRunControls.length}/4 dry-run, tanpa release, owner=${technicalOwner}`);
console.log(`Template review: ${reviewTemplates.length}/18 non-mock draft, owner=${templateOwner}`);
console.log("Approval template, Business Rules, release, dan outbound tetap terkunci menunggu keputusan CEO.");
