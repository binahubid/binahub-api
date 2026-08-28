import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { proposalDraftSchema } from "@/lib/admin-mutation-schemas";
import { generateAssessmentProposal } from "@/lib/ai-service";
import {
  calculateProposalCommercials,
  evaluateProposalGate,
  normalizeProposalRules,
  type ProposalModuleInput,
} from "@/lib/proposal-policy";
import { createServerSupabase } from "@/lib/supabase";

type AssessmentRow = {
  id: string;
  form_data: unknown;
  scores: unknown;
  category: string | null;
  ai_analysis: string | null;
  recommendations: unknown;
  overall_score: number | null;
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
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, proposalDraftSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_PROPOSAL_DRAFT");
  const input = parsed.data;
  const db = createServerSupabase();

  const [{ data: assessment, error: assessmentError }, { data: ruleSets, error: rulesError }] = await Promise.all([
    db.from("assessments")
      .select("id, form_data, scores, category, ai_analysis, recommendations, overall_score")
      .eq("id", input.assessmentId)
      .single(),
    db.from("business_rule_sets")
      .select("id, version, status, is_mock, rules")
      .in("status", ["active", "mock"])
      .order("created_at", { ascending: false }),
  ]);
  if (assessmentError || !assessment) return adminError(assessmentError?.message || "Assessment tidak ditemukan.", 404, "ASSESSMENT_NOT_FOUND");
  if (rulesError) return adminError(rulesError.message, 500, "BUSINESS_RULES_READ_FAILED");

  const selectedRuleSet = ruleSets?.find((rule) => rule.status === "active") || ruleSets?.find((rule) => rule.status === "mock") || null;
  const rules = normalizeProposalRules(selectedRuleSet);
  const requestedIds = input.moduleItems.map((item) => item.catalogModuleId);
  const { data: moduleRows, error: moduleError } = await db
    .from("catalog_modules")
    .select("id, product_id, module_code, name, standard_scope, pricing_unit, base_price, readiness_status, is_mock, active, catalog_version, catalog_products(product_key)")
    .in("id", requestedIds)
    .eq("active", true);
  if (moduleError) return adminError(moduleError.message, 500, "CATALOG_READ_FAILED");
  if (!moduleRows || moduleRows.length !== requestedIds.length) {
    return adminError("Satu atau lebih modul tidak ditemukan atau tidak aktif.", 400, "CATALOG_MODULE_UNAVAILABLE");
  }

  const quantityById = new Map(input.moduleItems.map((item) => [item.catalogModuleId, item.quantity]));
  const modules: ProposalModuleInput[] = moduleRows.map((row) => {
    const relation = row.catalog_products as unknown as { product_key?: string } | { product_key?: string }[] | null;
    const productKey = Array.isArray(relation) ? relation[0]?.product_key : relation?.product_key;
    return {
      id: row.id,
      moduleCode: row.module_code,
      productKey: productKey || "unknown",
      name: row.name,
      standardScope: row.standard_scope,
      pricingUnit: row.pricing_unit,
      basePrice: Number(row.base_price || 0),
      quantity: quantityById.get(row.id) || 1,
      readinessStatus: row.readiness_status,
      isMock: row.is_mock === true,
      catalogVersion: row.catalog_version,
    };
  });
  const commercials = calculateProposalCommercials(modules, input.discountPercent);
  const form = objectValue((assessment as AssessmentRow).form_data);
  const requiredDataComplete = [form.name, form.email, form.company, form.challenge || form.target]
    .every((value) => typeof value === "string" && value.trim().length > 0);
  const gate = evaluateProposalGate({
    rules,
    modules,
    totalBeforeTax: commercials.totalBeforeTax,
    discountPercent: input.discountPercent,
    scopeType: input.scopeType,
    aiConfidence: input.aiConfidence,
    riskFlags: input.riskFlags,
    requiredDataComplete,
  });
  const isSimulation = rules.isMock || modules.some((module) => module.isMock);

  const generatedProposal = await generateAssessmentProposal({
    name: String(form.name || "-"),
    email: String(form.email || "-"),
    company: String(form.company || "-"),
    role: String(form.role || ""),
    employees: String(form.employees || ""),
    challenge: String(form.challenge || ""),
    target: String(form.target || ""),
    category: (assessment as AssessmentRow).category || "",
    overallScore: Number((assessment as AssessmentRow).overall_score || 0),
    scores: objectValue((assessment as AssessmentRow).scores) as Record<string, number>,
    aiAnalysis: (assessment as AssessmentRow).ai_analysis || "",
    recommendations: arrayValue((assessment as AssessmentRow).recommendations) as Array<{ title?: string; diagnosis?: string; description?: string; service?: string; priority?: string }>,
    commercialContext: {
      items: modules.map((module) => ({
        name: module.name,
        standardScope: module.standardScope,
        pricingUnit: module.pricingUnit,
        quantity: module.quantity,
      })),
      totalBeforeTax: commercials.totalBeforeTax,
      currency: rules.currency,
      isSimulation,
    },
  });
  const proposal = {
    ...generatedProposal,
    isSimulation,
    rulesVersion: rules.version,
    commercialSnapshot: { ...commercials, currency: rules.currency, validityDays: rules.proposalValidityDays },
  };

  const generatedAt = new Date().toISOString();
  const draft = {
    proposal,
    commercials,
    scopeType: input.scopeType,
    notes: input.notes,
    riskFlags: input.riskFlags,
    aiConfidence: input.aiConfidence ?? null,
    requiredDataComplete,
    isSimulation,
    rulesVersion: rules.version,
    generatedAt,
  };
  const { error: updateError } = await db.from("assessments").update({
    proposal_draft_data: draft,
    proposal_data: proposal,
    proposal_gate_status: gate.status,
    proposal_gate_reasons: gate.reasons,
    proposal_catalog_version: rules.version,
    proposal_generated_at: generatedAt,
    proposal_approved_at: null,
    proposal_approved_by: null,
    proposal_status: gate.status === "pending_approval" ? "Menunggu Approval" : "Sedang Disusun",
  }).eq("id", input.assessmentId);
  if (updateError) return adminError(updateError.message, 500, "PROPOSAL_DRAFT_SAVE_FAILED");

  await db.from("proposal_approvals").update({ status: "cancelled" }).eq("assessment_id", input.assessmentId).eq("status", "pending");
  if (gate.status === "pending_approval") {
    const dueAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const { error: approvalError } = await db.from("proposal_approvals").insert({
      assessment_id: input.assessmentId,
      status: "pending",
      reasons: gate.reasons,
      requested_by: admin.email,
      due_at: dueAt,
    });
    if (approvalError) return adminError(approvalError.message, 500, "PROPOSAL_APPROVAL_CREATE_FAILED");
  }

  await logAdminEvent(db, {
    eventType: "proposal_draft_generated",
    targetType: "assessment",
    targetId: input.assessmentId,
    actor: admin.email,
    payload: { rulesVersion: rules.version, isSimulation, gateStatus: gate.status, reasonCodes: gate.reasons.map((reason) => reason.code) },
    status: gate.status,
    message: `Draft proposal dibuat dan dievaluasi dengan ${rules.version}.`,
  });

  return NextResponse.json({ success: true, draft, gate });
}
