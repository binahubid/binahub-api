import { expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { prepareSpinRecommendation } from '../src/lib/spin/service';
import { syntheticSpinNeeds } from '../src/lib/spin/synthetic-fixture';

// Explicit opt-in only. Real AI with synthetic needs/public catalog, no email or storage writes.
it.skipIf(process.env.BINAHUB_SPIN_AI_SMOKE!=='true')('analyses synthetic SPIN needs through the configured provider policy',async()=>{
 const result=await prepareSpinRecommendation(syntheticSpinNeeds());
 const codes=result.publicReportDraft.recommendations.map(item=>item.solutionCode);
 process.stdout.write(JSON.stringify({syntheticSpinAI:true,matchedPrograms:codes,consultationReasons:result.internalConsultant.consultationReasons})+'\n');
 expect(result.internalConsultant.consultationReasons).not.toContain('AI_MATCH_UNAVAILABLE');
 expect(codes.length).toBeGreaterThan(0);
 expect(codes).not.toContain('SS-32');
},40000);
