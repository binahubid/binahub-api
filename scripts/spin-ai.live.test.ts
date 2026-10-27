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
it.skipIf(process.env.BINAHUB_SPIN_AI_SMOKE!=='true')('matches synthetic benefit-based needs without a written target',async()=>{
 const result=await prepareSpinRecommendation(syntheticSpinNeeds({outcomeBasis:'benefits',evidence:[
  {id:'Q05',text:'Rapat lintas tim tidak menghasilkan keputusan dan tindak lanjut yang jelas.'},
  {id:'Q06',text:'Penanggung jawab tidak dicatat dan kesepakatan rapat sering terlupakan.'},
  {id:'Q14.other',text:'Koordinasi lintas tim lebih lancar melalui rapat yang efektif dan tindak lanjut yang konsisten.'},
 ]}));
 const codes=result.publicReportDraft.recommendations.map(item=>item.solutionCode);
 process.stdout.write(JSON.stringify({syntheticBenefitAI:true,matchedPrograms:codes})+'\n');
 expect(result.internalConsultant.consultationReasons).not.toContain('AI_MATCH_UNAVAILABLE');
 expect(codes.length).toBeGreaterThan(0);
},40000);
