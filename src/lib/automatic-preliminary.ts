import { generateAssessmentProposal, selectStandardCatalogModules } from "@/lib/ai-service";
import { sendProposalEmail } from "@/lib/email-service";
import { type ProposalResult } from "@/lib/pdf-service";
import { evaluateAssessmentProposalEligibility, type ProposalEligibility } from "@/lib/proposal-eligibility";
import { formatIdr } from "@/lib/proposal-policy";
import { automaticPreliminaryCommercialEligibility } from "@/lib/preliminary-commercial-policy";
import { createServerSupabase } from "@/lib/supabase";
import { isAutoSendableStandardModule } from "@/lib/standard-catalog-policy";

type AssessmentRow = {
  id: string;
  lead_id?: string | null;
  form_data: unknown;
  scores: unknown;
  category?: string | null;
  ai_analysis?: string | null;
  recommendations: unknown;
  overall_score?: number | null;
  proposal_status?: string | null;
  proposal_sent_at?: string | null;
};

type CatalogModuleRow = {
  id: string;
  module_code: string;
  name: string;
  standard_scope?: string | null;
  deliverables?: string | null;
  duration_label?: string | null;
  pricing_unit: string;
  base_price: number | string;
  minimum_quantity?: number | string | null;
  catalog_version: string;
  metadata?: Record<string, unknown> | null;
};

export type AutomaticPreliminaryResult = {
  outcome: "sent" | "already_sent" | "manual_review" | "already_processing";
  eligibility: ProposalEligibility;
  emailId?: string | null;
};

function objectValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      return [];
    }
  }
  return [];
}

function quantityFor(module: CatalogModuleRow) {
  const minimum = Math.ceil(Number(module.minimum_quantity || 1));
  return Number.isFinite(minimum) && minimum > 0 ? minimum : 1;
}

function lines(value: string | null | undefined) {
  return String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function localizedList(module: CatalogModuleRow, locale: "id" | "en", field: "contentOutline" | "outputs", fallback: string | null | undefined) {
  const localized = objectValue(objectValue(module.metadata).localized);
  const copy = objectValue(localized[locale]);
  return Array.isArray(copy[field])
    ? copy[field].filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : lines(fallback);
}

async function markManualReview(
  db: ReturnType<typeof createServerSupabase>,
  assessmentId: string,
  eligibility: ProposalEligibility,
) {
  await db.from("assessments").update({
    assessment_status: "Minta Proposal",
    proposal_status: "Diminta",
    proposal_gate_status: "pending_approval",
    proposal_gate_reasons: eligibility.missing.map((message) => ({
      code: "AUTO_PRELIMINARY_INELIGIBLE",
      message,
      severity: "blocking",
    })),
  }).eq("id", assessmentId);
}

export async function createAndSendAutomaticPreliminary(
  assessmentId: string,
  requestedAt = new Date().toISOString(),
): Promise<AutomaticPreliminaryResult> {
  const db = createServerSupabase();
  const { data, error } = await db.from("assessments")
    .select("id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, proposal_status, proposal_sent_at")
    .eq("id", assessmentId)
    .single();
  if (error || !data) throw new Error(error?.message || "Assessment tidak ditemukan.");
  const assessment = data as AssessmentRow;
  const eligibility = evaluateAssessmentProposalEligibility({
    formData: assessment.form_data,
    scores: assessment.scores,
    category: assessment.category,
    aiAnalysis: assessment.ai_analysis,
    recommendations: assessment.recommendations,
    overallScore: assessment.overall_score,
  });

  if (assessment.proposal_sent_at || assessment.proposal_status === "Terkirim") {
    return { outcome: "already_sent", eligibility };
  }
  if (!eligibility.eligible) {
    await markManualReview(db, assessmentId, eligibility);
    return { outcome: "manual_review", eligibility };
  }

  const { data: moduleRows, error: moduleError } = await db.from("catalog_modules")
    .select("id, module_code, name, standard_scope, deliverables, duration_label, pricing_unit, base_price, minimum_quantity, catalog_version, metadata")
    .eq("active", true)
    .eq("readiness_status", "ready")
    .eq("is_mock", false)
    .order("base_price", { ascending: true });
  if (moduleError) throw new Error(moduleError.message);

  const recommendations = arrayValue(assessment.recommendations);
  const officialModules = ((moduleRows || []) as unknown as CatalogModuleRow[])
    .filter(isAutoSendableStandardModule);
  if (officialModules.length === 0) {
    const catalogEligibility = {
      eligible: false,
      missing: ["modul Signature Solutions berharga tetap yang siap ditawarkan"],
      summary: "Belum ada modul standar resmi yang aman untuk pengiriman otomatis.",
    } satisfies ProposalEligibility;
    await markManualReview(db, assessmentId, catalogEligibility);
    return { outcome: "manual_review", eligibility: catalogEligibility };
  }

  const form = objectValue(assessment.form_data);
  const locale = form.locale === "en" ? "en" : "id";
  let selectedModules: CatalogModuleRow[];
  let selectionReason: string;
  let emailAccepted = false;
  try {
    const selection = await selectStandardCatalogModules({
      locale,
      challenge: String(form.challenge || ""),
      target: String(form.target || ""),
      category: assessment.category || "",
      scores: objectValue(assessment.scores) as Record<string, number>,
      recommendations: recommendations as Array<{ title?: string; diagnosis?: string; description?: string; service?: string }>,
      candidates: officialModules.map((module) => {
        const localized = objectValue(objectValue(module.metadata).localized);
        const copy = objectValue(localized[locale]);
        return {
          code: module.module_code,
          name: String(copy.name || module.name),
          summary: String(copy.summary || ""),
          scope: localizedList(module, locale, "contentOutline", module.standard_scope).join("; "),
          objectives: Array.isArray(copy.learningObjectives) ? copy.learningObjectives.filter((value): value is string => typeof value === "string").slice(0, 4) : [],
          duration: module.duration_label || "",
          serviceBrand: String(copy.serviceBrand || ""),
        };
      }),
    });
    selectedModules = selection.moduleCodes.map((code) => officialModules.find((module) => module.module_code === code)!);
    selectionReason = selection.reasoning;
  } catch (selectionError) {
    console.error("[Automatic Standard Proposal] Catalog selection failed:", selectionError);
    const reviewEligibility = { eligible: false, missing: ["pemilihan solusi katalog belum tervalidasi"], summary: "AI belum dapat memilih modul standar dengan aman; tinjau secara manual." } satisfies ProposalEligibility;
    await markManualReview(db, assessmentId, reviewEligibility);
    return { outcome: "manual_review", eligibility: reviewEligibility };
  }

  const commercialEligibility = automaticPreliminaryCommercialEligibility(selectedModules.map((module) => ({
    basePrice: Number(module.base_price || 0),
    quantity: quantityFor(module),
  })));
  if (!commercialEligibility.eligible) {
    const reviewEligibility = {
      eligible: false,
      missing: [commercialEligibility.reason],
      summary: commercialEligibility.reason,
    } satisfies ProposalEligibility;
    await markManualReview(db, assessmentId, reviewEligibility);
    return { outcome: "manual_review", eligibility: reviewEligibility };
  }

  const claim = await db.from("assessments").update({
    assessment_status: "Minta Proposal",
    proposal_status: "Sedang Disusun",
    proposal_requested_at: requestedAt,
  }).eq("id", assessmentId)
    .is("proposal_sent_at", null)
    .in("proposal_status", ["Belum Diminta", "Diminta", "Gagal Otomatis"])
    .select("id")
    .maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) return { outcome: "already_processing", eligibility };

  const modules = selectedModules.map((module) => {
    const quantity = quantityFor(module);
    const basePrice = Number(module.base_price || 0);
    return {
      name: module.name,
      standardScope: module.standard_scope,
      pricingUnit: module.pricing_unit,
      quantity,
      basePrice,
      lineTotal: basePrice * quantity,
      duration: module.duration_label || "",
      deliverables: localizedList(module, locale, "outputs", module.deliverables),
    };
  });
  const total = modules.reduce((sum, module) => sum + module.lineTotal, 0);
  const catalogVersion = Array.from(new Set(selectedModules.map((module) => module.catalog_version))).join("+");
  const localizedObjectives = selectedModules.flatMap((module) => {
    const localized = objectValue(objectValue(module.metadata).localized);
    const copy = objectValue(localized[locale]);
    return Array.isArray(copy.learningObjectives)
      ? copy.learningObjectives.filter((value): value is string => typeof value === "string").slice(0, 4)
      : [];
  });

  try {
    const generated = await generateAssessmentProposal({
      locale,
      name: String(form.name || "Bapak/Ibu"),
      email: String(form.email || ""),
      company: String(form.company || "Organisasi Anda"),
      role: String(form.role || ""),
      employees: String(form.employees || ""),
      challenge: String(form.challenge || ""),
      target: String(form.target || ""),
      category: assessment.category || "",
      overallScore: Number(assessment.overall_score || 0),
      scores: objectValue(assessment.scores) as Record<string, number>,
      aiAnalysis: assessment.ai_analysis || "",
      recommendations: recommendations as Array<{ title?: string; diagnosis?: string; description?: string; service?: string; priority?: string }>,
      commercialContext: {
        items: modules.map((module) => ({
          name: module.name,
          standardScope: module.standardScope,
          pricingUnit: module.pricingUnit,
          quantity: module.quantity,
        })),
        totalBeforeTax: total,
        currency: "IDR",
        isSimulation: false,
      },
    });
    const proposal: ProposalResult = {
      ...generated,
      documentKind: "commercial",
      proposalType: "standard",
      scope: selectedModules.flatMap((module) => localizedList(module, locale, "contentOutline", module.standard_scope)).slice(0, 12),
      deliverables: modules.flatMap((module) => module.deliverables).slice(0, 12),
      timeline: locale === "en"
        ? `Priced delivery days: ${modules.map((module) => `${module.name}: ${module.quantity} day(s)`).join("; ")}. Catalog duration: ${selectedModules.map((module) => `${module.name}: ${module.duration_label}`).join("; ")}. Longer delivery requires a revised quote.`
        : `Hari pelaksanaan yang dihargai: ${modules.map((module) => `${module.name}: ${module.quantity} hari`).join("; ")}. Durasi katalog: ${selectedModules.map((module) => `${module.name}: ${module.duration_label}`).join("; ")}. Pelaksanaan lebih lama memerlukan penawaran ulang.`,
      learningObjectives: localizedObjectives,
      selectedSolutions: selectedModules.map((module) => {
        const localized = objectValue(objectValue(module.metadata).localized);
        const copy = objectValue(localized[locale]);
        const englishCopy = objectValue(localized.en);
        return {
          code: module.module_code,
          name: typeof copy.name === "string" ? copy.name : module.name,
          nameEn: typeof englishCopy.name === "string" ? englishCopy.name : module.name,
          focus: typeof copy.summary === "string" ? copy.summary : module.standard_scope || "",
          focusEn: typeof englishCopy.summary === "string" ? englishCopy.summary : module.standard_scope || "",
        };
      }),
      commercialSnapshot: {
        items: modules.map((module) => ({ name: module.name, quantity: module.quantity, pricingUnit: module.pricingUnit, basePrice: module.basePrice, lineTotal: module.lineTotal })),
        subtotal: total,
        discountPercent: 0,
        discountAmount: 0,
        totalBeforeTax: total,
        currency: "IDR",
        validityDays: 14,
      },
      investmentNote: locale === "en"
        ? `Standard catalog base price: ${formatIdr(total)} for ${modules.map((module) => `${module.name} (${module.quantity} delivery day(s))`).join(" + ")}. Taxes and changes to participants, location, duration, or scope are confirmed separately.`
        : `Harga dasar katalog: ${formatIdr(total)} untuk ${modules.map((module) => `${module.name} (${module.quantity} hari pelaksanaan)`).join(" + ")}. Pajak serta perubahan jumlah peserta, lokasi, durasi, atau cakupan dikonfirmasi terpisah.`,
      packages: generated.packages?.map((item) => ({ ...item, price: formatIdr(total), scope: selectedModules.flatMap((module) => localizedList(module, locale, "contentOutline", module.standard_scope)).slice(0, 12), deliverables: modules.flatMap((module) => module.deliverables).slice(0, 12) })),
      isSimulation: false,
      rulesVersion: `automatic-standard-v2:${catalogVersion}`,
    };
    const email = await sendProposalEmail(
      String(form.email),
      String(form.name),
      String(form.company),
      proposal,
      assessmentId,
      locale,
      `assessment-${assessmentId}-automatic-standard-v2`,
    );
    emailAccepted = true;
    const sentAt = new Date().toISOString();
    const emailId = email.data?.id || null;
    const draft = {
      proposal,
      automatic: true,
      kind: "standard",
      selectedModuleIds: selectedModules.map((module) => module.id),
      selectionReason,
      basePriceTotal: total,
      generatedAt: sentAt,
      eligibility,
    };
    const saved = await db.from("assessments").update({
      assessment_status: "Proposal Terkirim",
      proposal_status: "Terkirim",
      proposal_sent_at: sentAt,
      proposal_email_id: emailId,
      proposal_data: proposal,
      proposal_draft_data: draft,
      proposal_gate_status: "clear",
      proposal_gate_reasons: [],
      proposal_catalog_version: catalogVersion,
      proposal_generated_at: sentAt,
    }).eq("id", assessmentId).eq("proposal_status", "Sedang Disusun").select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error(`Email terkirim tetapi status perlu direkonsiliasi: ${saved.error?.message || "baris assessment tidak diperbarui"}`);
    if (assessment.lead_id) {
      await db.from("leads").update({
        lifecycle_stage: "lead",
        opportunity_stage: "proposal",
        last_meaningful_activity_at: sentAt,
      }).eq("id", assessment.lead_id);
    }
    return { outcome: "sent", eligibility, emailId };
  } catch (error) {
    await db.from("assessments").update({
      proposal_status: emailAccepted ? "Perlu Rekonsiliasi" : "Diminta",
      proposal_gate_status: "pending_approval",
      proposal_gate_reasons: [{
        code: emailAccepted ? "STANDARD_PROPOSAL_EMAIL_STATE_UNCERTAIN" : "AUTO_STANDARD_PROPOSAL_FAILED",
        message: emailAccepted ? "Provider menerima email, tetapi status database belum terkonfirmasi. Rekonsiliasi sebelum mengirim ulang." : "Pengiriman proposal standar belum selesai; tindak lanjut manusia diperlukan.",
        severity: "blocking",
      }],
    }).eq("id", assessmentId).eq("proposal_status", "Sedang Disusun");
    await db.from("email_failures").insert({
      target_type: "assessment_preliminary",
      target_id: assessmentId,
      error: error instanceof Error ? error.message : String(error),
      retry_count: 0,
    });
    throw error;
  }
}
