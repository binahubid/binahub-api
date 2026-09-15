import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createOutboundCampaignToken,
  outboundCampaignTokenDigest,
  outboundLinkSigningReady,
  verifyOutboundCampaignToken,
} from "./outbound-campaign-links";

const originalSecret = process.env.ACQUISITION_LINK_SECRET;

describe("controlled outbound campaign links", () => {
  beforeEach(() => {
    process.env.ACQUISITION_LINK_SECRET = "phase20-test-secret-that-is-longer-than-32-characters";
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.ACQUISITION_LINK_SECRET;
    else process.env.ACQUISITION_LINK_SECRET = originalSecret;
  });

  it("issues an opaque token that verifies and can be stored as a digest", () => {
    const token = createOutboundCampaignToken();

    expect(token).toMatch(/^bh20\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("campaign");
    expect(verifyOutboundCampaignToken(token)).toBe(true);
    expect(outboundCampaignTokenDigest(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(outboundLinkSigningReady()).toBe(true);
  });

  it("rejects a token whose signature has been changed", () => {
    const token = createOutboundCampaignToken();
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(verifyOutboundCampaignToken(tampered)).toBe(false);
  });
});
