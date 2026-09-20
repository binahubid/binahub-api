import { describe, expect, it } from "vitest";
import { calculateTbosTeamScore } from "./tbos-scoring";

describe("calculateTbosTeamScore", () => {
  const observations = [{
    teamId: "team-1",
    missionCode: "program_observation",
    status: "submitted",
    scores: [
      { dimensionCode: "communication", dimensionName: "Communication", levelValue: 5 },
      { dimensionCode: "adaptability", dimensionName: "Adaptability", levelValue: 1 },
    ],
  }];

  it("only includes competencies selected for the program", () => {
    const result = calculateTbosTeamScore(
      "team-1",
      observations,
      { program_observation: ["communication", "adaptability"] },
      ["communication"],
    );

    expect(result.overallScore).toBe(5);
    expect(result.dimensionScores.map((score) => score.dimensionCode)).toEqual(["communication"]);
  });
});
