import { generateAssessmentProposal, selectStandardCatalogModules } from "@/lib/ai-service";
import { sendProposalEmail } from "@/lib/email-service";
import { type ProposalResult } from "@/lib/pdf-service";
import { evaluateAssessmentProposalEligibility, type ProposalEligibility } from "@/lib/proposal-eligibility";
import { formatIdr } from "@/lib/proposal-policy";
import { automaticPreliminaryCommercialEligibility } from "@/lib/preliminary-commercial-policy";
import { createServerSupabase } from "@/lib/supabase";
import { isAutoSendableStandardModule } from "@/lib/standard-catalog-policy";
import { selectCatalogFallback } from "@/lib/standard-catalog-selection";
import { recordRuntimeError } from "@/lib/runtime-observability";
import { safeTelemetryText } from "@/lib/telemetry-privacy";

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
  proposal_draft_data?: unknown;
  proposal_catalog_version?: string | null;
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
  const saved = await db.from("assessments").update({
    assessment_status: "Minta Proposal",
    proposal_status: "Menunggu Approval",
    proposal_gate_status: "pending_approval",
    proposal_gate_reasons: eligibility.missing.map((message) => ({
      code: "AUTO_PRELIMINARY_INELIGIBLE",
      message,
      severity: "blocking",
    })),
  }).eq("id", assessmentId).eq("proposal_status", "Sedang Disusun").select("id").maybeSingle();
  if (saved.error || !saved.data) throw new Error(saved.error?.message || "Status tinjauan proposal belum tersimpan.");
}

async function deliverStandardProposal(db: ReturnType<typeof createServerSupabase>, assessment: AssessmentRow, proposal: ProposalResult, draft: Record<string, unknown>, catalogVersion: string, eligibility: ProposalEligibility) {
  const form = objectValue(assessment.form_data);
  const locale: "id" | "en" = form.locale === "en" ? "en" : "id";
  const generatedAt = String(draft.generatedAt);
  let emailAccepted = false;
  try {
    // Persist the exact snapshot before attempting delivery. Retries use this
    // same document, link timestamp and idempotency key, not a new AI draft.
    const prepared = await db.from("assessments").update({
      proposal_data: proposal, proposal_draft_data: draft,
      proposal_catalog_version: catalogVersion, proposal_generated_at: generatedAt,
    }).eq("id", assessment.id).eq("proposal_status", "Sedang Disusun").select("id").maybeSingle();
    if (prepared.error || !prepared.data) throw new Error(prepared.error?.message || "Status proposal berubah sebelum pengiriman.");
    const email = await sendProposalEmail(String(form.email), String(form.name), String(form.company), proposal, assessment.id, locale, `assessment-${assessment.id}-automatic-standard-v2`, generatedAt);
    emailAccepted = true;
    const sentAt = new Date().toISOString();
    const emailId = email.data?.id || null;
    const saved = await db.from("assessments").update({
      assessment_status: "Proposal Terkirim", proposal_status: "Terkirim",
      proposal_sent_at: sentAt, proposal_email_id: emailId,
      proposal_gate_status: "clear", proposal_gate_reasons: [],
    }).eq("id", assessment.id).eq("proposal_status", "Sedang Disusun").select("id").maybeSingle();
    if (saved.error || !saved.data) throw new Error(saved.error?.message || "Status pengiriman belum tersimpan.");
    if (assessment.lead_id) {
      const lead = await db.from("leads").update({ lifecycle_stage: "lead", opportunity_stage: "proposal", last_meaningful_activity_at: sentAt }).eq("id", assessment.lead_id);
      if (lead.error) await recordRuntimeError({ code: "STANDARD_PROPOSAL_LEAD_UPDATE_FAILED", message: lead.error.message, route: "/api/proposal/request" });
    }
    return { outcome: "sent", eligibility, emailId } satisfies AutomaticPreliminaryResult;
  } catch (error) {
    if (emailAccepted) {
      await db.from("assessments").update({
        proposal_status: "Perlu Rekonsiliasi", proposal_gate_status: "pending_approval",
        proposal_gate_reasons: [{ code: "STANDARD_PROPOSAL_EMAIL_STATE_UNCERTAIN", message: "Provider menerima email, tetapi status database belum terkonfirmasi. Rekonsiliasi sebelum mengirim ulang.", severity: "blocking" }],
      }).eq("id", assessment.id).eq("proposal_status", "Sedang Disusun");
    }
    throw error;
  }
}

export async function createAndSendAutomaticPreliminary(
  assessmentId: string,
  requestedAt = new Date().toISOString(),
): Promise<AutomaticPreliminaryResult> {
  const db = createServerSupabase();
  const { data, error } = await db.from("assessments")
    .select("id, lead_id, form_data, scores, category, ai_analysis, recommendations, overall_score, proposal_status, proposal_sent_at, proposal_draft_data, proposal_catalog_version")
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
  const previousDraft = objectValue(assessment.proposal_draft_data);
  if (previousDraft.proposal && previousDraft.automatic !== true) return { outcome: "manual_review", eligibility };
  if (!["Belum Diminta", "Diminta", "Gagal Otomatis"].includes(assessment.proposal_status || "")) return { outcome: "already_processing", eligibility };
  // Claim BEFORE the expensive work: repeat clicks cannot run two selectors,
  // send twice, or overwrite a completed request with a late failure.
  const claim = await db.from("assessments").update({
    assessment_status: "Minta Proposal", proposal_status: "Sedang Disusun",
    proposal_requested_at: requestedAt,
  }).eq("id", assessmentId).is("proposal_sent_at", null)
    .eq("proposal_status", assessment.proposal_status)
    .select("id").maybeSingle();
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data) return { outcome: "already_processing", eligibility };

  try {
    if (!eligibility.eligible) {
      await markManualReview(db, assessmentId, eligibility);
      return { outcome: "manual_review", eligibility };
    }
    if (previousDraft.automatic === true && previousDraft.proposal && previousDraft.generatedAt && assessment.proposal_catalog_version) {
      const generatedTime = Date.parse(String(previousDraft.generatedAt));
      if (!Number.isFinite(generatedTime) || Date.now() - generatedTime > 23 * 60 * 60 * 1000) {
        // Provider idempotency has a finite retention window. An old ambiguous
        // delivery must be checked by staff, never silently sent a second time.
        await db.from("assessments").update({ proposal_status: "Perlu Rekonsiliasi", proposal_gate_status: "pending_approval", proposal_gate_reasons: [{ code: "STANDARD_PROPOSAL_RETRY_WINDOW_EXPIRED", message: "Batas waktu retry aman terlewati. Periksa arsip email sebelum mengirim ulang.", severity: "blocking" }] }).eq("id", assessmentId).eq("proposal_status", "Sedang Disusun");
        return { outcome: "manual_review", eligibility };
      }
      return await deliverStandardProposal(db, assessment, previousDraft.proposal as ProposalResult, previousDraft, assessment.proposal_catalog_version, eligibility);
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
    const locale: "id" | "en" = form.locale === "en" ? "en" : "id";
    let selectedModules: CatalogModuleRow[];
    let selectionReason: string;
    let selectionMethod: "ai" | "assessment_catalog_match" = "ai";
    const selectionInput = {
      locale,
      challenge: String(form.challenge || ""), target: String(form.target || ""),
      category: assessment.category || "", scores: objectValue(assessment.scores) as Record<string, number>,
      recommendations: recommendations as Array<{ title?: string; diagnosis?: string; description?: string; service?: string; priority?: string }>,
      candidates: officialModules.map((module) => {
        const copy = objectValue(objectValue(objectValue(module.metadata).localized)[locale]);
        return { code: module.module_code, name: String(copy.name || module.name), summary: String(copy.summary || ""), scope: localizedList(module, locale, "contentOutline", module.standard_scope).join("; "), objectives: Array.isArray(copy.learningObjectives) ? copy.learningObjectives.filter((value): value is string => typeof value === "string").slice(0, 4) : [], duration: module.duration_label || "", serviceBrand: String(copy.serviceBrand || "") };
      }),
    };
    try {
      const selection = await selectStandardCatalogModules(selectionInput);
      if (selection.moduleCodes.some((code) => !officialModules.some((module) => module.module_code === code))) throw new Error("Pemilihan modul di luar katalog resmi.");
      selectedModules = selection.moduleCodes.map((code) => officialModules.find((module) => module.module_code === code)!);
      selectionReason = selection.reasoning;
    } catch (selectionError) {
      const detail = safeTelemetryText(selectionError instanceof Error ? selectionError.message : String(selectionError));
      await recordRuntimeError({ code: "STANDARD_PROPOSAL_SELECTION_FAILED", message: detail, route: "/api/proposal/request" });
      const fallback = selectCatalogFallback(selectionInput);
      if (!fallback) {
        const reviewEligibility = { eligible: false, missing: ["Belum ada kecocokan modul standar yang cukup kuat dengan kebutuhan assessment."], summary: "Tinjau kebutuhan dan pemilihan modul sebelum menawarkan program." } satisfies ProposalEligibility;
        await markManualReview(db, assessmentId, reviewEligibility);
        return { outcome: "manual_review", eligibility: reviewEligibility };
      }
      selectedModules = fallback.moduleCodes.map((code) => officialModules.find((module) => module.module_code === code)!);
      selectionReason = fallback.reasoning;
      selectionMethod = "assessment_catalog_match";
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
        ? copy.learningObjectives.filter((value): value is string => typeof value === "string")
        : [];
    });

    const generated = await generateAssessmentProposal({
      aiBudget: { maxTokens: 2048, perAttemptTimeoutMs: 10_000, totalTimeoutMs: 25_000 },
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
      scope: selectedModules.flatMap((module) => localizedList(module, locale, "contentOutline", module.standard_scope)),
      deliverables: modules.flatMap((module) => module.deliverables),
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
      packages: generated.packages?.map((item) => ({ ...item, price: formatIdr(total), duration: selectedModules.map((module) => `${module.name}: ${module.duration_label}`).join("; "), scope: selectedModules.flatMap((module) => localizedList(module, locale, "contentOutline", module.standard_scope)), deliverables: modules.flatMap((module) => module.deliverables) })),
      isSimulation: false,
      rulesVersion: `automatic-standard-v2:${catalogVersion}`,
    };
    const draft = {
      proposal,
      automatic: true,
      kind: "standard",
      selectedModuleIds: selectedModules.map((module) => module.id),
      selectionReason,
      selectionMethod,
      basePriceTotal: total,
      generatedAt: new Date().toISOString(),
      eligibility,
    };
    return await deliverStandardProposal(db, assessment, proposal, draft, catalogVersion, eligibility);
  } catch (error) {
    await db.from("assessments").update({
      proposal_status: "Gagal Otomatis",
      proposal_gate_status: "pending_approval",
      proposal_gate_reasons: [{
        code: "AUTO_STANDARD_PROPOSAL_FAILED",
        message: "Penyusunan atau pengiriman gagal. Jalankan ulang proposal standar setelah memeriksa log; jangan kirim draf baru secara terpisah.",
        severity: "blocking",
      }],
    }).eq("id", assessmentId).eq("proposal_status", "Sedang Disusun");
    await db.from("email_failures").insert({
      target_type: "assessment_preliminary",
      target_id: assessmentId,
      error: safeTelemetryText(error instanceof Error ? error.message : String(error)),
      retry_count: 0,
    });
    await recordRuntimeError({ code: "AUTO_STANDARD_PROPOSAL_FAILED", message: error instanceof Error ? error.message : String(error), route: "/api/proposal/request" });
    throw error;
  }
}
