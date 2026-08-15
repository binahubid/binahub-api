import { beforeEach, describe, expect, it } from "vitest";
import {
  createOpaqueToken,
  createProposalToken,
  hashOpaqueToken,
  opaqueTokenMatches,
  verifyProposalToken,
} from "./secure-token";

describe("secure tokens", () => {
  beforeEach(() => {
    process.env.PROPOSAL_LINK_SECRET = "test-only-secret-with-sufficient-entropy";
  });

  it("creates unique opaque tokens and verifies only the matching hash", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();

    expect(first).not.toBe(second);
    expect(opaqueTokenMatches(first, hashOpaqueToken(first))).toBe(true);
    expect(opaqueTokenMatches(second, hashOpaqueToken(first))).toBe(false);
  });

  it("binds proposal tokens to the assessment and expiry", () => {
    const token = createProposalToken("assessment-a", 60);

    expect(verifyProposalToken("assessment-a", token)).toBe(true);
    expect(verifyProposalToken("assessment-b", token)).toBe(false);
    expect(verifyProposalToken("assessment-a", `${token}tampered`)).toBe(false);
    expect(verifyProposalToken("assessment-a", createProposalToken("assessment-a", -1))).toBe(false);
  });
});
