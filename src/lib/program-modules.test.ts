import { describe, expect, it } from "vitest";
import { completeProgramModuleSelectionSchema, PROGRAM_MODULE_KEYS, programModuleKeySchema } from "./program-modules";

describe("program module contract", () => {
  it("menerima kelima modul termasuk pre-test dan post-test", () => {
    const parsed = completeProgramModuleSelectionSchema.safeParse(
      PROGRAM_MODULE_KEYS.map((moduleKey) => ({ moduleKey, enabled: moduleKey !== "post_test" })),
    );
    expect(parsed.success).toBe(true);
  });

  it("menolak payload lama yang hanya mengirim tiga modul", () => {
    const parsed = completeProgramModuleSelectionSchema.safeParse([
      { moduleKey: "tbos", enabled: true },
      { moduleKey: "lep", enabled: true },
      { moduleKey: "binainsight", enabled: false },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("menolak modul duplikat atau tidak dikenal", () => {
    const duplicate = completeProgramModuleSelectionSchema.safeParse([
      { moduleKey: "tbos", enabled: true },
      { moduleKey: "tbos", enabled: false },
      { moduleKey: "binainsight", enabled: false },
      { moduleKey: "pre_test", enabled: true },
      { moduleKey: "post_test", enabled: true },
    ]);
    expect(duplicate.success).toBe(false);
    expect(programModuleKeySchema.safeParse("survey").success).toBe(false);
  });
});
