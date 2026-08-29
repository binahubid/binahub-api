export const UAT_STATUSES = [
  "not_started",
  "in_progress",
  "passed",
  "failed",
  "blocked",
  "not_applicable",
] as const;

export type UatStatus = (typeof UAT_STATUSES)[number];

export type UatScenarioReadiness = {
  id: string;
  scenarioKey: string;
  required: boolean;
  status: UatStatus;
  owner: string | null;
  evidenceNote: string | null;
  evidenceUrl: string | null;
  actualResult: string | null;
  blockerReason: string | null;
};

export function evaluatePilotReadiness(scenarios: UatScenarioReadiness[]) {
  const required = scenarios.filter((scenario) => scenario.required);
  const passed = required.filter((scenario) => scenario.status === "passed");
  const failed = required.filter((scenario) => scenario.status === "failed");
  const blocked = required.filter((scenario) => scenario.status === "blocked");
  const inProgress = required.filter((scenario) => scenario.status === "in_progress");
  const remaining = required.filter((scenario) => scenario.status !== "passed");
  const evidenceIssueCount = passed.filter((scenario) => (
    !scenario.owner
    || !scenario.evidenceNote
    || scenario.evidenceNote.trim().length < 5
    || !scenario.actualResult
    || scenario.actualResult.trim().length < 5
  )).length;
  const definitionsReady = required.length >= 12;
  const eligibleForHumanReview = definitionsReady
    && remaining.length === 0
    && evidenceIssueCount === 0;

  return {
    generatedAt: new Date().toISOString(),
    activationLocked: true,
    humanDecisionRequired: true,
    state: eligibleForHumanReview ? "eligible_for_human_review" : "uat_incomplete",
    summary: {
      total: scenarios.length,
      required: required.length,
      passed: passed.length,
      failed: failed.length,
      blocked: blocked.length,
      inProgress: inProgress.length,
      remaining: remaining.length,
      evidenceIssueCount,
      completionPercent: required.length ? Math.round((passed.length / required.length) * 100) : 0,
    },
    blockers: [
      ...(!definitionsReady ? [{ key: "scenario_definitions", label: "Definisi skenario UAT belum lengkap" }] : []),
      ...(failed.length ? [{ key: "required_failed", label: `${failed.length} skenario wajib gagal` }] : []),
      ...(blocked.length ? [{ key: "required_blocked", label: `${blocked.length} skenario wajib terblokir` }] : []),
      ...(remaining.length ? [{ key: "required_remaining", label: `${remaining.length} skenario wajib belum lulus` }] : []),
      ...(evidenceIssueCount ? [{ key: "evidence_incomplete", label: `${evidenceIssueCount} bukti kelulusan belum lengkap` }] : []),
    ],
  };
}
