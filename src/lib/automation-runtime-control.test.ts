import { describe, expect, it } from "vitest";
import {
  evaluateAutomationActivation,
  type AutomationActivationContext,
} from "./automation-runtime-control";

const activeRelease = {
  id: "00000000-0000-4000-8000-000000000001",
  status: "scheduled",
  isMock: false,
  startsAt: "2026-09-02T01:00:00.000Z",
  endsAt: "2026-09-02T03:00:00.000Z",
};

function context(overrides: Partial<AutomationActivationContext> = {}): AutomationActivationContext {
  return {
    requestedMode: "pilot",
    environmentDryRun: false,
    pilotMasterSwitchEnabled: true,
    liveMasterSwitchEnabled: false,
    release: activeRelease,
    now: new Date("2026-09-02T02:00:00.000Z"),
    ...overrides,
  };
}

describe("automation runtime control", () => {
  it("allows the database kill switch to disable every environment", () => {
    expect(evaluateAutomationActivation(context({ requestedMode: "disabled" })).effectiveMode).toBe("disabled");
  });

  it("keeps environment dry-run authoritative over pilot and live requests", () => {
    const pilot = evaluateAutomationActivation(context({ environmentDryRun: true }));
    const live = evaluateAutomationActivation(context({ requestedMode: "live", environmentDryRun: true }));
    expect(pilot.effectiveMode).toBe("dry_run");
    expect(pilot.activationBlockers).toContain("environment_dry_run");
    expect(live.effectiveMode).toBe("dry_run");
  });

  it("requires an explicit pilot master switch", () => {
    const decision = evaluateAutomationActivation(context({ pilotMasterSwitchEnabled: false }));
    expect(decision.effectiveMode).toBe("dry_run");
    expect(decision.activationBlockers).toEqual(["pilot_master_switch_disabled"]);
  });

  it("requires an additional explicit master switch for live mode", () => {
    const blocked = evaluateAutomationActivation(context({ requestedMode: "live" }));
    const allowed = evaluateAutomationActivation(context({ requestedMode: "live", liveMasterSwitchEnabled: true }));
    expect(blocked.activationBlockers).toContain("live_master_switch_disabled");
    expect(blocked.effectiveMode).toBe("dry_run");
    expect(allowed.effectiveMode).toBe("live");
  });

  it("fails closed without a real scheduled release", () => {
    expect(evaluateAutomationActivation(context({ release: null })).activationBlockers).toContain("release_missing");
    expect(evaluateAutomationActivation(context({ release: { ...activeRelease, isMock: true } })).activationBlockers).toContain("release_mock");
    expect(evaluateAutomationActivation(context({ release: { ...activeRelease, status: "approved" } })).activationBlockers).toContain("release_not_scheduled");
  });

  it("fails closed before and after the approved change window", () => {
    const before = evaluateAutomationActivation(context({ now: new Date("2026-09-02T00:59:59.000Z") }));
    const after = evaluateAutomationActivation(context({ now: new Date("2026-09-02T03:00:00.000Z") }));
    expect(before.releaseWindowState).toBe("before_window");
    expect(before.effectiveMode).toBe("dry_run");
    expect(after.releaseWindowState).toBe("after_window");
    expect(after.effectiveMode).toBe("dry_run");
  });

  it("allows pilot only inside a real scheduled window with every server switch open", () => {
    const decision = evaluateAutomationActivation(context());
    expect(decision).toEqual({
      effectiveMode: "pilot",
      activationEligible: true,
      activationBlockers: [],
      releaseWindowState: "active",
    });
  });
});
