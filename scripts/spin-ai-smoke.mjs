import { spawnSync } from 'node:child_process';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','scripts/spin-ai.live.test.ts'],{
 env:{...process.env,BINAHUB_SPIN_AI_SMOKE:'true'},stdio:'inherit',
});
process.exitCode=result.status??1;
