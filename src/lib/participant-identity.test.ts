import { describe, expect, it } from "vitest";
import {
  hasAmbiguousParticipantIdentity,
  findSimilarParticipantNames,
  matchingParticipantAccesses,
  normalizeParticipantName,
} from "./participant-identity";

describe("participant identity", () => {
  it("normalizes spacing, casing, and unicode consistently", () => {
    expect(normalizeParticipantName("  ANDI   Pratama ")).toBe("andi pratama");
    expect(normalizeParticipantName("Ａｎｄｉ")).toBe("andi");
  });

  it("finds an existing program access for the same participant name", () => {
    const rows = [
      { id: "1", team_name: "Andi Pratama" },
      { id: "2", team_name: "Bunga Lestari" },
    ];
    expect(matchingParticipantAccesses(rows, " andi   pratama ")).toEqual([rows[0]]);
  });

  it("detects legacy duplicate participant records as ambiguous", () => {
    expect(hasAmbiguousParticipantIdentity([
      { participant_id: "participant-a" },
      { participant_id: "participant-b" },
    ])).toBe(true);
  });

  it("flags likely misspellings or shortened names for admin review", () => {
    const existing = ["Dea Lestari", "Bunga Lestari"];
    expect(findSimilarParticipantNames(existing, "Dhea Lestari")).toEqual(["Dea Lestari"]);
    expect(findSimilarParticipantNames(existing, "Dea Lesatri")).toEqual(["Dea Lestari"]);
    expect(findSimilarParticipantNames(existing, "Dea L")).toEqual(["Dea Lestari"]);
    expect(findSimilarParticipantNames(existing, "Citra Dewi")).toEqual([]);
  });
});
