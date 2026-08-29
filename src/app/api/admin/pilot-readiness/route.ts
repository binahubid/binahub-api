import { NextRequest, NextResponse } from "next/server";
import { adminError, parseValidatedBody } from "@/lib/admin-api";
import { requireAdmin } from "@/lib/admin-auth";
import { uatScenarioUpdateSchema } from "@/lib/admin-mutation-schemas";
import { evaluatePilotReadiness, type UatScenarioReadiness, type UatStatus } from "@/lib/pilot-readiness";
import { createServerSupabase } from "@/lib/supabase";

type ScenarioRow = {
  id: string;
  scenario_key: string;
  category: string;
  title: string;
  objective: string;
  expected_result: string;
  required: boolean;
  status: UatStatus;
  owner: string | null;
  environment: "local" | "staging" | "production";
  evidence_note: string | null;
  evidence_url: string | null;
  actual_result: string | null;
  blocker_reason: string | null;
  last_tested_at: string | null;
  last_tested_by: string | null;
  sort_order: number;
  metadata: Record<string, unknown> | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

function mapScenario(item: ScenarioRow) {
  return {
    id: item.id,
    scenarioKey: item.scenario_key,
    category: item.category,
    title: item.title,
    objective: item.objective,
    expectedResult: item.expected_result,
    required: item.required,
    status: item.status,
    owner: item.owner,
    environment: item.environment,
    evidenceNote: item.evidence_note,
    evidenceUrl: item.evidence_url,
    actualResult: item.actual_result,
    blockerReason: item.blocker_reason,
    lastTestedAt: item.last_tested_at,
    lastTestedBy: item.last_tested_by,
    sortOrder: item.sort_order,
    metadata: item.metadata || {},
    updatedBy: item.updated_by,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const db = createServerSupabase();
  const [scenarios, events] = await Promise.all([
    db.from("uat_scenarios")
      .select("id, scenario_key, category, title, objective, expected_result, required, status, owner, environment, evidence_note, evidence_url, actual_result, blocker_reason, last_tested_at, last_tested_by, sort_order, metadata, updated_by, created_at, updated_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    db.from("uat_scenario_events")
      .select("id, scenario_id, event_type, actor, before_snapshot, after_snapshot, note, created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const queryError = scenarios.error || events.error;
  if (queryError) {
    if (queryError.code === "42P01" || queryError.message?.includes("does not exist")) {
      return NextResponse.json({
        success: true,
        phase9Ready: false,
        activationLocked: true,
        humanDecisionRequired: true,
        scenarios: [],
        events: [],
      });
    }
    return adminError(queryError.message, 500, "PILOT_READINESS_LOAD_FAILED");
  }

  const mappedScenarios = ((scenarios.data || []) as ScenarioRow[]).map(mapScenario);
  const readinessInput: UatScenarioReadiness[] = mappedScenarios.map((item) => ({
    id: item.id,
    scenarioKey: item.scenarioKey,
    required: item.required,
    status: item.status,
    owner: item.owner,
    evidenceNote: item.evidenceNote,
    evidenceUrl: item.evidenceUrl,
    actualResult: item.actualResult,
    blockerReason: item.blockerReason,
  }));

  return NextResponse.json({
    success: true,
    phase9Ready: true,
    ...evaluatePilotReadiness(readinessInput),
    scenarios: mappedScenarios,
    events: (events.data || []).map((item) => ({
      id: item.id,
      scenarioId: item.scenario_id,
      eventType: item.event_type,
      actor: item.actor,
      beforeSnapshot: item.before_snapshot || {},
      afterSnapshot: item.after_snapshot || {},
      note: item.note,
      createdAt: item.created_at,
    })),
  });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req);
  if ("error" in admin) return adminError(admin.error || "Akses admin tidak valid.", admin.status, "ADMIN_REQUIRED");

  const parsed = await parseValidatedBody(req, uatScenarioUpdateSchema);
  if (parsed.error || !parsed.data) return adminError(parsed.error, 400, "INVALID_UAT_SCENARIO");

  const input = parsed.data;
  const { data, error } = await createServerSupabase().rpc("update_uat_scenario", {
    p_scenario_id: input.scenarioId,
    p_actor: admin.email,
    p_status: input.status,
    p_owner: input.owner || null,
    p_environment: input.environment,
    p_evidence_note: input.evidenceNote || null,
    p_evidence_url: input.evidenceUrl || null,
    p_actual_result: input.actualResult || null,
    p_blocker_reason: input.blockerReason || null,
  });

  if (error) {
    const knownErrors: Array<[string, string, number]> = [
      ["UAT_SCENARIO_NOT_FOUND", "Skenario UAT tidak ditemukan.", 404],
      ["UAT_OWNER_REQUIRED", "Owner wajib untuk pengujian aktif.", 400],
      ["UAT_EVIDENCE_REQUIRED", "Catatan bukti dan hasil aktual minimal 5 karakter.", 400],
      ["UAT_BLOCKER_REQUIRED", "Alasan blocker minimal 5 karakter.", 400],
      ["UAT_EVIDENCE_URL_INVALID", "URL bukti harus memakai HTTPS.", 400],
      ["UAT_REQUIRED_SCENARIO_CANNOT_SKIP", "Skenario wajib tidak dapat ditandai tidak berlaku.", 400],
    ];
    const known = knownErrors.find(([code]) => error.message.includes(code));
    if (known) return adminError(known[1], known[2], known[0]);
    return adminError(error.message, 500, "UAT_SCENARIO_UPDATE_FAILED");
  }

  return NextResponse.json({ success: true, scenario: data });
}
