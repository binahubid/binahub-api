import { describe, expect, it } from "vitest";
import { evaluatePilotReadiness, type UatScenarioReadiness } from "./pilot-readiness";

function scenario(index: number, overrides: Partial<UatScenarioReadiness> = {}): UatScenarioReadiness {
  return {
    id: `scenario-${index}`,
    scenarioKey: `scenario_${index}`,
    required: true,
    status: "passed",
    owner: "tester@binahub.id",
    evidenceNote: "Bukti pengujian tersedia.",
    evidenceUrl: "https://example.com/evidence",
    actualResult: "Hasil sesuai ekspektasi.",
    blockerReason: null,
    ...overrides,
  };
}

describe("pilot readiness", () => {
  it("only unlocks human review after all required scenarios pass with evidence", () => {
    const result = evaluatePilotReadiness(Array.from({ length: 12 }, (_, index) => scenario(index)));
    expect(result).toMatchObject({
      state: "eligible_for_human_review",
      activationLocked: true,
      humanDecisionRequired: true,
      summary: { required: 12, passed: 12, remaining: 0, completionPercent: 100 },
    });
  });

  it("keeps the pilot locked when a required scenario is blocked", () => {
    const scenarios = Array.from({ length: 12 }, (_, index) => scenario(index));
    scenarios[3] = scenario(3, { status: "blocked", blockerReason: "Menunggu keputusan bisnis." });
    const result = evaluatePilotReadiness(scenarios);
    expect(result.state).toBe("uat_incomplete");
    expect(result.summary).toMatchObject({ blocked: 1, remaining: 1 });
    expect(result.blockers.map((blocker) => blocker.key)).toContain("required_blocked");
  });

  it("does not count optional not-applicable scenarios as blockers", () => {
    const scenarios = Array.from({ length: 12 }, (_, index) => scenario(index));
    scenarios.push(scenario(13, { required: false, status: "not_applicable", owner: null }));
    const result = evaluatePilotReadiness(scenarios);
    expect(result.state).toBe("eligible_for_human_review");
    expect(result.summary.required).toBe(12);
  });
});
