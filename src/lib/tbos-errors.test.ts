import { describe, expect, it } from "vitest";
import { mapTbosTeamMutationError } from "./tbos-errors";

describe("mapTbosTeamMutationError", () => {
  it("turns duplicate names into a friendly conflict", () => {
    expect(mapTbosTeamMutationError({ code: "23505", message: "unique constraint" })).toEqual({
      status: 409,
      message: "Nama tim sudah dipakai pada batch ini. Gunakan nama lain.",
    });
  });

  it("does not leak a legacy batch constraint name", () => {
    const result = mapTbosTeamMutationError({
      code: "23514",
      message: 'new row violates check constraint "tbos_teams_batch_check"',
    });

    expect(result.status).toBe(409);
    expect(result.message).toContain("skema batch terbaru");
    expect(result.message).not.toContain("tbos_teams_batch_check");
  });

  it("hides unexpected database details", () => {
    expect(mapTbosTeamMutationError({ code: "XX000", message: "private database detail" })).toEqual({
      status: 500,
      message: "Tim belum dapat disimpan. Coba lagi atau hubungi administrator.",
    });
  });
});
