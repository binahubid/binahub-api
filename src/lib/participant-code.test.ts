import { describe, expect, it } from "vitest";
import {
  createParticipantCode,
  hashParticipantCode,
  normalizeParticipantCode,
  participantCodeHint,
} from "./participant-code";

describe("participant code", () => {
  it("creates an unambiguous code with sufficient entropy", () => {
    const codes = new Set(Array.from({ length: 100 }, createParticipantCode));
    expect(codes.size).toBe(100);
    for (const code of codes) expect(code).toMatch(/^BH-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  });

  it("accepts compact or lowercase input", () => {
    expect(normalizeParticipantCode("bh2abc9xyz")).toBe("BH-2ABC-9XYZ");
    expect(hashParticipantCode("bh2abc9xyz")).toBe(hashParticipantCode("BH-2ABC-9XYZ"));
    expect(participantCodeHint("BH-2ABC-9XYZ")).toBe("9XYZ");
  });
});
