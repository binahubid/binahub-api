import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

// Load normal deployment-local env before Vitest sets NODE_ENV=test and skips .env.local.
nextEnv.loadEnvConfig(process.cwd());
const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "scripts/ai-fallback.live.test.ts"], {
  env: { ...process.env, BINAHUB_AI_LIVE_SMOKE: "true" },
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
