import { describe, expect, it } from "vitest";
import { classifyInboundAttribution, compactInboundAttribution } from "./inbound-journey";

describe("inbound journey attribution", () => {
  it("does not invent a source for direct traffic", () => {
    expect(classifyInboundAttribution({})).toBe("direct");
  });

  it("distinguishes paid social from organic social", () => {
    expect(classifyInboundAttribution({ utmSource: "instagram", utmMedium: "paid_social" })).toBe("paid_social");
    expect(classifyInboundAttribution({ referrer: "https://www.linkedin.com/feed" })).toBe("social");
  });

  it("uses click IDs as paid evidence", () => {
    expect(classifyInboundAttribution({ utmSource: "google", gclid: "abc" })).toBe("paid_search");
  });

  it("removes empty values before storing attribution", () => {
    expect(compactInboundAttribution({ utmSource: "  google  ", referrer: "" })).toEqual({ utmSource: "google" });
  });
});
