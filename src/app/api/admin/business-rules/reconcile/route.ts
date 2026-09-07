import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { adminError, logAdminEvent, parseValidatedBody } from "@/lib/admin-api";
import { businessRuleReconciliationSchema } from "@/lib/admin-mutation-schemas";
import { createServerSupabase } from "@/lib/supabase";

const LEGACY_BLOCKER_LABELS: Record<string, string> = {
  commercial_policy_not_aligned: "Kebijakan komersial belum sesuai keputusan default.",
  governance_owner_assignments_incomplete: "Tujuh fungsi governance belum seluruhnya memiliki owner aktif.",
  approval_assignments_incomplete: "Enam human gate belum seluruhnya memiliki approver aktif.",
  risk_sla_policies_incomplete: "Empat SLA risiko belum seluruhnya aktif dan memiliki owner.",
  finance_legal_wording_incomplete: "Wording proposal dan invoice belum seluruhnya disetujui.",
  outreach_templates_incomplete: "Delapan belas template follow-up belum seluruhnya approved dan memiliki owner.",
};

function activationBlockers(rules: unknown) {
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return [];
  const activation = (rules as Record<string, unknown>).activation;
  if (!activation || typeof activation !== "object" || Array.isArray(activation)) return [];
  const blockers = (activation as Record<string, unknown>).blockers;
  return Array.isArray(blockers) ? blockers.filter((item): item is string => typeof item === "string") : [];
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, businessRuleReconciliationSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_BUSINESS_RULE_RECONCILIATION");

  const db = createServerSupabase();
  const { data, error } = await db.rpc("reconcile_phase17_business_rules", {
    p_actor: admin.email,
  });
  if (error) {
    if (error.message.includes("BUSINESS_RULE_BASE_NOT_FOUND")) {
      return adminError("Snapshot Business Rules lama tidak ditemukan.", 409, "BUSINESS_RULE_BASE_NOT_FOUND");
    }
    if (error.message.includes("BUSINESS_RULE_ACTOR_INVALID")) {
      return adminError("Identitas administrator tidak valid.", 400, "BUSINESS_RULE_ACTOR_INVALID");
    }
    if (error.code === "42883" || error.message.includes("does not exist")) {
      return adminError("Migration penyelarasan Business Rules belum diterapkan.", 409, "BUSINESS_RULE_RECONCILIATION_MIGRATION_REQUIRED");
    }
    return adminError(error.message, 500, "BUSINESS_RULE_RECONCILIATION_FAILED");
  }

  const blockers = activationBlockers(data?.rules);
  await logAdminEvent(db, {
    eventType: blockers.length ? "business_rules_alignment_blocked" : "business_rules_aligned",
    targetType: "business_rule_set",
    targetId: data?.id || null,
    actor: admin.email,
    payload: {
      version: data?.version || null,
      status: data?.status || null,
      blockers,
    },
    status: blockers.length ? "Blocked" : "Approved",
    message: blockers.length
      ? `Penyelarasan Business Rules menyisakan ${blockers.length} blocker.`
      : `Business Rules ${data?.version || "terbaru"} diselaraskan dengan keputusan Phase 17 oleh ${admin.email}.`,
  });

  return NextResponse.json({
    success: true,
    aligned: data?.status === "active" && blockers.length === 0,
    activationLocked: true,
    runtimeChanged: false,
    ruleSet: data,
    blockers: blockers.map((key) => ({ key, label: LEGACY_BLOCKER_LABELS[key] || key })),
    message: blockers.length
      ? "Keputusan belum dapat diaktifkan karena data governance saat ini belum lengkap."
      : "Keputusan Phase 17 telah menjadi Business Rules aktif. Runtime, release, dan master switch tidak berubah.",
  });
}
