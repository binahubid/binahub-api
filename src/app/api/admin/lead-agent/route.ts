import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { getLeadDiscoveryConfig, publicLeadDiscoveryConfig } from "@/lib/lead-discovery-config";
import { LeadDiscoveryError, loadLeadDiscoveryGovernance, runLeadDiscovery } from "@/lib/lead-discovery-service";
import { createServerSupabase } from "@/lib/supabase";

const previewSchema = z.object({
  action: z.literal("run_preview"),
  confirmation: z.literal("DISCOVERY_PREVIEW_ONLY"),
}).strict();

function missingTable(error: { code?: string; message?: string } | null | undefined) {
  return ["42P01", "42703", "PGRST204"].includes(error?.code || "") || error?.message?.includes("does not exist");
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const db = createServerSupabase();
  const config = getLeadDiscoveryConfig();
  const [runs, candidates] = await Promise.all([
    db.from("lead_discovery_runs").select("*,company_review_count").order("started_at", { ascending: false }).limit(20),
    db.from("lead_discovery_candidates").select("*,candidate_kind,employee_range").order("created_at", { ascending: false }).limit(100),
  ]);
  const schemaMissing = [runs.error, candidates.error].some(missingTable);
  if (schemaMissing) {
    return NextResponse.json({ success: true, phase18Ready: false, config: publicLeadDiscoveryConfig(config), readiness: { ready: false, blockers: ["Migration AI Lead Agent 0041 dan 0042 belum lengkap."] }, runs: [], candidates: [] });
  }
  const queryError = runs.error || candidates.error;
  if (queryError) return adminError(queryError.message, 500, "LEAD_AGENT_LOAD_FAILED");

  const readinessBlockers = [...config.blockers];
  let governance: Awaited<ReturnType<typeof loadLeadDiscoveryGovernance>> | null = null;
  if ((config.sourceId || config.sourceKey) && !config.blockers.some((item) => item.includes("Sumber data berizin"))) {
    try { governance = await loadLeadDiscoveryGovernance(db, config); }
    catch (error) { readinessBlockers.push(error instanceof Error ? error.message : "Tata kelola discovery belum valid."); }
  }
  return NextResponse.json({
    success: true,
    phase18Ready: true,
    config: publicLeadDiscoveryConfig(config),
    readiness: {
      ready: readinessBlockers.length === 0,
      blockers: [...new Set(readinessBlockers)],
      source: governance?.source ? { id: governance.source.id, name: governance.source.name, status: governance.source.status, active: governance.source.active } : null,
      campaign: governance?.campaign ? { id: governance.campaign.id, name: governance.campaign.name, status: governance.campaign.status } : null,
    },
    runs: runs.data || [],
    candidates: candidates.data || [],
  });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");
  const parsed = await parseValidatedBody(req, previewSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error || "Konfirmasi pratinjau tidak valid.", 400, "INVALID_LEAD_AGENT_ACTION");
  try {
    const result = await runLeadDiscovery({
      db: createServerSupabase(),
      actor: admin.email,
      idempotencyKey: `admin-preview:${randomUUID()}`,
      forceDryRun: true,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof LeadDiscoveryError) return adminError(error.message, error.status, error.code);
    return adminError(error instanceof Error ? error.message : "Pratinjau discovery gagal.", 500, "LEAD_AGENT_PREVIEW_FAILED");
  }
}
