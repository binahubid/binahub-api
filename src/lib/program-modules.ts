import { z } from "zod";

export const PROGRAM_MODULE_KEYS = ["tbos", "lep", "binainsight", "pre_test", "post_test", "peta"] as const;

export type ProgramModuleKey = (typeof PROGRAM_MODULE_KEYS)[number];

export const programModuleKeySchema = z.enum(PROGRAM_MODULE_KEYS);

export const programModuleItemSchema = z.object({
  moduleKey: programModuleKeySchema,
  enabled: z.boolean(),
});

export const completeProgramModuleSelectionSchema = z.array(programModuleItemSchema)
  .min(PROGRAM_MODULE_KEYS.length - 1).max(PROGRAM_MODULE_KEYS.length)
  .refine(
    (modules) => new Set(modules.map((module) => module.moduleKey)).size === modules.length
      && PROGRAM_MODULE_KEYS.filter(key=>key!=="peta").every(key=>modules.some(module=>module.moduleKey===key)),
    "Setiap modul program wajib disebut tepat satu kali.",
  );
