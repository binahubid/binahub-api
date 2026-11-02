import { afterEach,describe,expect,it,vi } from 'vitest';
import { GET } from './route';
afterEach(()=>vi.unstubAllEnvs());
describe('public liveness is not a database/provider readiness claim',()=>{
  it('remains uncached, marks dependencies unchecked and contains no private operational data',async()=>{
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA','0123456789abcdef');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','PRIVATE_SENTINEL');
    const response=GET(),body=await response.json();
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(body).toMatchObject({status:'ok',service:'binahub-api',check:'liveness',readiness:'not_checked',revision:'0123456789ab'});
    expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SENTINEL|queues|heartbeat|recipient/);
  });
});
