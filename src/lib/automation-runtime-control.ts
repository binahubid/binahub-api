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
export type AutomationReleaseWindowState =
  | "not_required"
  | "release_missing"
  | "release_mock"
  | "release_not_scheduled"
  | "window_missing"
  | "window_invalid"
  | "before_window"
  | "active"
  | "after_window";

export type AutomationActivationBlocker =
  | "environment_dry_run"
  | "pilot_master_switch_disabled"
  | "live_master_switch_disabled"
  | "release_missing"
  | "release_mock"
  | "release_not_scheduled"
  | "release_window_missing"
  | "release_window_invalid"
  | "release_window_not_started"
  | "release_window_closed";

export type AutomationReleaseWindow = {
  id: string;
  status: string;
  isMock: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export type AutomationActivationDecision = {
  effectiveMode: AutomationEffectiveMode;
  activationEligible: boolean;
  activationBlockers: AutomationActivationBlocker[];
  releaseWindowState: AutomationReleaseWindowState;
};

export type AutomationRuntimeControl = AutomationActivationDecision & {
  workflowKey: AutomationWorkflowKey;
  requestedMode: AutomationRequestedMode;
  maximumItemsPerRun: number;
  pilotReleaseId: string | null;
  owner: string | null;
  version: number;
  environmentDryRun: boolean;
  pilotMasterSwitchEnabled: boolean;
  liveMasterSwitchEnabled: boolean;
  release: AutomationReleaseWindow | null;
  controlSource: "database" | "safe_fallback";
};

export type AutomationActivationContext = {
  requestedMode: AutomationRequestedMode;
  environmentDryRun: boolean;
  pilotMasterSwitchEnabled: boolean;
  liveMasterSwitchEnabled: boolean;
  release: AutomationReleaseWindow | null;
  now?: Date;
};

type RuntimeControlDb = ReturnType<typeof createServerSupabase>;

function validDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function evaluateAutomationActivation(
  context: AutomationActivationContext,
): AutomationActivationDecision {
  const {
    requestedMode,
    environmentDryRun,
    pilotMasterSwitchEnabled,
    liveMasterSwitchEnabled,
    release,
  } = context;

  if (requestedMode === "disabled") {
    return {
      effectiveMode: "disabled",
      activationEligible: false,
      activationBlockers: [],
      releaseWindowState: "not_required",
    };
  }
  if (requestedMode === "dry_run") {
    return {
      effectiveMode: "dry_run",
      activationEligible: false,
      activationBlockers: [],
      releaseWindowState: "not_required",
    };
  }

  const blockers: AutomationActivationBlocker[] = [];
  let releaseWindowState: AutomationReleaseWindowState = "release_missing";

  if (environmentDryRun) blockers.push("environment_dry_run");
  if (!pilotMasterSwitchEnabled) blockers.push("pilot_master_switch_disabled");
  if (requestedMode === "live" && !liveMasterSwitchEnabled) {
    blockers.push("live_master_switch_disabled");
  }

  if (!release) {
    blockers.push("release_missing");
  } else if (release.isMock) {
    releaseWindowState = "release_mock";
    blockers.push("release_mock");
  } else if (release.status !== "scheduled") {
    releaseWindowState = "release_not_scheduled";
    blockers.push("release_not_scheduled");
  } else if (!release.startsAt || !release.endsAt) {
    releaseWindowState = "window_missing";
    blockers.push("release_window_missing");
  } else {
    const startsAt = validDate(release.startsAt);
    const endsAt = validDate(release.endsAt);
    if (!startsAt || !endsAt || endsAt <= startsAt) {
      releaseWindowState = "window_invalid";
      blockers.push("release_window_invalid");
    } else {
      const now = context.now || new Date();
      if (now < startsAt) {
        releaseWindowState = "before_window";
        blockers.push("release_window_not_started");
      } else if (now >= endsAt) {
        releaseWindowState = "after_window";
        blockers.push("release_window_closed");
      } else {
        releaseWindowState = "active";
      }
    }
  }

  const activationEligible = blockers.length === 0;
  return {
    effectiveMode: activationEligible ? requestedMode : "dry_run",
    activationEligible,
    activationBlockers: blockers,
    releaseWindowState,
  };
}

export async function loadAutomationRuntimeControl(
  db: RuntimeControlDb,
  workflowKey: AutomationWorkflowKey,
  environmentDryRun: boolean,
  options: {
    pilotMasterSwitchEnabled?: boolean;
    liveMasterSwitchEnabled?: boolean;
    now?: Date;
  } = {},
): Promise<AutomationRuntimeControl> {
  const pilotMasterSwitchEnabled = options.pilotMasterSwitchEnabled
    ?? process.env.AUTOMATION_PILOT_ENABLED === "true";
  const liveMasterSwitchEnabled = options.liveMasterSwitchEnabled
    ?? process.env.AUTOMATION_LIVE_ENABLED === "true";
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
        pilotMasterSwitchEnabled: false,
        liveMasterSwitchEnabled: false,
        release: null,
        activationEligible: false,
        activationBlockers: ["environment_dry_run", "pilot_master_switch_disabled"],
        releaseWindowState: "not_required",
        controlSource: "safe_fallback",
      };
    }
    throw new Error(`Runtime control gagal dibaca: ${error.message}`);
  }
  if (!data) throw new Error(`Runtime control ${workflowKey} tidak ditemukan.`);

  let release: AutomationReleaseWindow | null = null;
  if (data.pilot_release_id) {
    const { data: releaseData, error: releaseError } = await db.from("pilot_release_plans")
      .select("id, status, is_mock, starts_at, ends_at")
      .eq("id", data.pilot_release_id)
      .maybeSingle();
    if (releaseError) throw new Error(`Release pilot gagal dibaca: ${releaseError.message}`);
    if (releaseData) {
      release = {
        id: releaseData.id,
        status: releaseData.status,
        isMock: releaseData.is_mock,
        startsAt: releaseData.starts_at,
        endsAt: releaseData.ends_at,
      };
    }
  }

  const requestedMode = data.requested_mode as AutomationRequestedMode;
  const activation = evaluateAutomationActivation({
    requestedMode,
    environmentDryRun,
    pilotMasterSwitchEnabled,
    liveMasterSwitchEnabled,
    release,
    now: options.now,
  });

  return {
    workflowKey,
    requestedMode,
    ...activation,
    maximumItemsPerRun: Math.max(1, Math.min(Number(data.maximum_items_per_run) || 1, 500)),
    pilotReleaseId: data.pilot_release_id || null,
    owner: data.owner || null,
    version: Number(data.version) || 1,
    environmentDryRun,
    pilotMasterSwitchEnabled,
    liveMasterSwitchEnabled,
    release,
    controlSource: "database",
  };
}
