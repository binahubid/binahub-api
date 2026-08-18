import { describe, expect, it } from "vitest";
import { participantAccessExpiry, programAccessAvailable, publicProgram } from "../../../../lib/client-program";

const program = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "PRIVATE-CODE",
  title: "Leadership Camp",
  organization_id: "22222222-2222-4222-8222-222222222222",
  status: "active",
  start_date: "2026-08-01",
  end_date: "2099-08-03",
  location: "Jakarta",
  organization: [{ name: "PT Bina Karya" }],
};

describe("client program access", () => {
  it("never exposes the access code in the public program preview", () => {
    const preview = publicProgram(program, ["lep"]);
    expect(preview).not.toHaveProperty("code");
    expect(preview).toMatchObject({
      id: program.id,
      companyName: "PT Bina Karya",
      modules: ["lep"],
      available: true,
    });
  });

  it("marks draft programs unavailable", () => {
    expect(publicProgram({ ...program, status: "draft" }, ["tbos"]).available).toBe(false);
  });

  it("expires participant access at the end of a dated program", () => {
    expect(participantAccessExpiry("2026-08-03")).toBe("2026-08-03T16:59:59.999Z");
  });

  it("uses a bounded fallback expiry for programs without an end date", () => {
    expect(participantAccessExpiry(null, Date.UTC(2026, 0, 1))).toBe("2026-06-30T00:00:00.000Z");
  });

  it("blocks an active program after its end date", () => {
    expect(programAccessAvailable({ status: "active", end_date: "2026-08-03" }, Date.parse("2026-08-03T17:00:00.000Z"))).toBe(false);
  });
});
