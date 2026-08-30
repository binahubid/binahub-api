import type { createServerSupabase } from "@/lib/supabase";

export const AUTOMATION_WORKFLOW_KEYS = [
  "follow_up_scheduler",
  "transformation_event_worker",
  "client_operations_daily",
  "acquisition_batch_processor",
] as const;

export type AutomationWorkflowKey = (typeof AUTOMATION_WORKFLOW_KEYS)[number];
export type AutomationRequestedMode = "disabled" | "dry_run" | "pilot" | "live";
export type AutomationEffectiveMode = AutomationRequestedMode;

export type AutomationRuntimeControl = {
  workflowKey: AutomationWorkflowKey;
  requestedMode: AutomationRequestedMode;
  effectiveMode: AutomationEffectiveMode;
  maximumItemsPerRun: number;
  pilotReleaseId: string | null;
  owner: string | null;
  version: number;
  environmentDryRun: boolean;
  controlSource: "database" | "safe_fallback";
};

type RuntimeControlDb = ReturnType<typeof createServerSupabase>;

export function resolveEffectiveAutomationMode(
  requestedMode: AutomationRequestedMode,
  environmentDryRun: boolean,
): AutomationEffectiveMode {
  if (requestedMode === "disabled") return "disabled";
  if (environmentDryRun) return "dry_run";
  if (requestedMode === "dry_run") return "dry_run";
  return requestedMode;
}

export async function loadAutomationRuntimeControl(
  db: RuntimeControlDb,
  workflowKey: AutomationWorkflowKey,
  environmentDryRun: boolean,
): Promise<AutomationRuntimeControl> {
  const { data, error } = await db.from("automation_runtime_controls")
    .select("workflow_key, requested_mode, maximum_items_per_run, pilot_release_id, owner, version")
    .eq("workflow_key", workflowKey)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || error.message.includes("does not exist")) {
      return {
        workflowKey,
        requestedMode: "dry_run",
        effectiveMode: "dry_run",
        maximumItemsPerRun: 1,
        pilotReleaseId: null,
        owner: null,
        version: 0,
        environmentDryRun: true,
        controlSource: "safe_fallback",
      };
    }
    throw new Error(`Runtime control gagal dibaca: ${error.message}`);
  }
  if (!data) throw new Error(`Runtime control ${workflowKey} tidak ditemukan.`);

  const requestedMode = data.requested_mode as AutomationRequestedMode;
  return {
    workflowKey,
    requestedMode,
    effectiveMode: resolveEffectiveAutomationMode(requestedMode, environmentDryRun),
    maximumItemsPerRun: Math.max(1, Math.min(Number(data.maximum_items_per_run) || 1, 500)),
    pilotReleaseId: data.pilot_release_id || null,
    owner: data.owner || null,
    version: Number(data.version) || 1,
    environmentDryRun,
    controlSource: "database",
  };
}
