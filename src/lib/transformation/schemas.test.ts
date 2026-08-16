import { describe, expect, it } from "vitest";
import { createEngagementSchema } from "./schemas";

const validProgram = {
  organizationName: "PT Bina Karya Indonesia",
  code: "BKI-2026",
  title: "Leadership Program",
  type: "transformation",
  status: "draft",
};

describe("createEngagementSchema", () => {
  it("requires a company name", () => {
    expect(createEngagementSchema.safeParse({ ...validProgram, organizationName: "" }).success).toBe(false);
  });

  it("accepts an omitted location", () => {
    expect(createEngagementSchema.safeParse(validProgram).success).toBe(true);
  });

  it("rejects locations longer than 200 characters", () => {
    expect(createEngagementSchema.safeParse({ ...validProgram, location: "x".repeat(201) }).success).toBe(false);
  });
});
