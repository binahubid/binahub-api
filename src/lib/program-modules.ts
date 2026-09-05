import { z } from "zod";

export const PROGRAM_MODULE_KEYS = ["tbos", "lep", "binainsight", "pre_test", "post_test"] as const;

export type ProgramModuleKey = (typeof PROGRAM_MODULE_KEYS)[number];

export const programModuleKeySchema = z.enum(PROGRAM_MODULE_KEYS);

export const programModuleItemSchema = z.object({
  moduleKey: programModuleKeySchema,
  enabled: z.boolean(),
});

export const completeProgramModuleSelectionSchema = z.array(programModuleItemSchema)
  .length(PROGRAM_MODULE_KEYS.length, "Seluruh pilihan modul program wajib dikirim.")
  .refine(
    (modules) => new Set(modules.map((module) => module.moduleKey)).size === PROGRAM_MODULE_KEYS.length,
    "Setiap modul program wajib disebut tepat satu kali.",
  );
