import { describe, expect, it } from "vitest";
import { resolveEffectiveAutomationMode } from "./automation-runtime-control";

describe("automation runtime control", () => {
  it("allows the database kill switch to disable every environment", () => {
    expect(resolveEffectiveAutomationMode("disabled", false)).toBe("disabled");
    expect(resolveEffectiveAutomationMode("disabled", true)).toBe("disabled");
  });

  it("keeps environment dry-run authoritative over pilot and live requests", () => {
    expect(resolveEffectiveAutomationMode("pilot", true)).toBe("dry_run");
    expect(resolveEffectiveAutomationMode("live", true)).toBe("dry_run");
  });

  it("never upgrades a database dry-run request in a live-capable environment", () => {
    expect(resolveEffectiveAutomationMode("dry_run", false)).toBe("dry_run");
  });

  it("only resolves pilot/live when both database request and environment allow it", () => {
    expect(resolveEffectiveAutomationMode("pilot", false)).toBe("pilot");
    expect(resolveEffectiveAutomationMode("live", false)).toBe("live");
  });
});
