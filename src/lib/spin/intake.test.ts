import { describe,it,expect,vi } from 'vitest';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
vi.mock('server-only',()=>({}));
import { SPIN_DEFINITION,summaryHash,validateSpinAnswers,validateSpinWrite,spinInternalRules,spinNeeds } from './intake';
import { spinOptions,spinVisible,spinSummary,spinSanitize,SPIN_NOTICE_VERSION,type SpinAnswers } from './form';
import { buildSpinReport } from './report';
import { buildSpinRecommendationResult } from './recommendation';
import { renderSpinPDF } from './pdf';
export function completeAnswers():SpinAnswers {
 const a:SpinAnswers={};
 for(const f of SPIN_DEFINITION.fields){if(!spinVisible(f,a))continue;
  if(!f.required)continue;
  if(f.type==='text')a[f.key]='Contoh kebutuhan kerja yang ingin diperbaiki.';
  else if(f.type==='number')a[f.key]=20;
  else {const options=spinOptions(f,a);a[f.key]=f.type==='multi'?[options[0].value]:options[0].value;}
 }
 return spinSanitize(SPIN_DEFINITION,{...a,countStatus:'known',participantCount:20,programScope:'one_team',problemCluster:'C8',symptoms:['S3'],effects:['E1'],barriers:['none'],priorEfforts:['P8'],approaches:['A1'],duration:'one',deliveryMode:'onsite',location:'Jakarta',facilities:'ready',desiredOutcome:'Rapat menghasilkan keputusan dan tindak lanjut yang jelas.'});
}
describe('SPIN public question and report contract',()=>{
 it('keeps browser validation identical, without a server dependency',()=>{expect(readFileSync('../app-binahub/src/lib/spin-form.ts','utf8').replace(/\r/g,'')).toBe(readFileSync('src/lib/spin/form.ts','utf8').replace(/\r/g,''));});
 it('accepts a complete path and preserves confirmed raw source answers',()=>{const a=validateSpinAnswers(completeAnswers(),true);expect(spinSummary(SPIN_DEFINITION,a).outcome).toContain('Rapat');expect(summaryHash(a)).toHaveLength(64);});
 it('rejects unknown fields, bad options, exclusive combinations and sensitive free text',()=>{
 for(const a of [{...completeAnswers(),price:1},{...completeAnswers(),problemCluster:'C99'},{...completeAnswers(),effects:['E1','E8']},{...completeAnswers(),desiredOutcome:'Hubungi person@example.invalid'}])expect(()=>validateSpinAnswers(a,true)).toThrow();
 });
 it('removes stale conditional fields and validates mirrored benefits',()=>{
 const a=spinSanitize(SPIN_DEFINITION,{...completeAnswers(),deliveryMode:'online',venue:'outdoor',location:'Jakarta'});
 expect(a).not.toHaveProperty('venue');expect(a).not.toHaveProperty('location');
 expect(()=>validateSpinAnswers({...completeAnswers(),implications:['I1'],benefits:['I8']},true)).toThrow();
 });
 it('invalidates a summary only when its underlying answers change',()=>{
 const a=validateSpinAnswers(completeAnswers(),true),before=summaryHash(a);
 expect(summaryHash({...a,budget:'available'})).toBe(before);
 expect(summaryHash({...a,desiredOutcome:'Tujuan berubah.'})).not.toBe(before);
 const input={key:'a'.repeat(64),revision:0,answers:a,confirmation:{hash:before,status:'confirmed',corrections:{}}};
 expect(validateSpinWrite(input).summary).not.toBeNull();
 expect(()=>validateSpinWrite({...input,answers:{...a,desiredOutcome:'Tujuan berubah.'}})).toThrow('SPIN_SUMMARY_CHANGED');
 });
 it('keeps four signals independent and applies conservative rules instead of incorrect sample arithmetic',()=>{
 const a={...completeAnswers(),priority:'high',decisionRole:'sponsor',budget:'proposed',impactScope:'units'};
 expect(spinInternalRules(a,{status:'confirmed'})).toMatchObject({signalCount:4,leadTemperature:'hot'});
 expect(spinInternalRules({...a,barriers:['B2','B3']},{status:'confirmed'}).fitType).toBe('B');
 expect(spinInternalRules({...a,barriers:['B1','B2'],approaches:['A7']},{status:'confirmed'}).fitType).toBe('C');
 });
 it('keeps system/unclear cases unpriced, public output free of internal flags and commercial expiry',()=>{
 const a=completeAnswers(),needs=spinNeeds(a,'confirmed'),selection=buildSpinRecommendationResult(needs,{matches:[]});
 const result=buildSpinReport({id:'11111111-1111-4111-8111-111111111111',submittedAt:'2026-10-22T03:00:00Z',company:'Synthetic Company',answers:a,summary:spinSummary(SPIN_DEFINITION,a),status:'confirmed',selection});
 expect(result.publicReport.solutions).toEqual([]);
 expect(JSON.stringify(result.publicReport)).not.toMatch(/fitType|leadTemperature|pricingVersion|prepared_not_active|validity|expire|INTERNAL|{{/);
 expect(result.publicReport.taxNote).toContain('dikonfirmasi');
 });
 it('generates a PDF from the same strict public snapshot (not internal records)',async()=>{
 const a=completeAnswers(),selection=buildSpinRecommendationResult(spinNeeds(a,'confirmed'),{matches:[{solutionCode:'SS-29',evidenceLinks:[{evidenceId:'Q05',objectiveId:'SS-29.LO01'},{evidenceId:'Q13',objectiveId:'SS-29.LO01'}]}]});
 const {publicReport:r}=buildSpinReport({id:'11111111-1111-4111-8111-111111111111',submittedAt:'2026-10-22T03:00:00Z',company:'Synthetic Company',answers:a,summary:spinSummary(SPIN_DEFINITION,a),status:'confirmed',selection});
 expect(r.investments[0].baseAmountIdr).toBe(25000000);expect(r.solutions[0].outputs.length).toBeGreaterThan(0);
 expect(r.solutions[0].components.join(' ')).not.toMatch(/investasi standar|sub-brand|kompetensi inti|model harga/i);
 const buffer=await renderSpinPDF(r);expect(buffer.subarray(0,4).toString()).toBe('%PDF');
 if(process.env.SPIN_RENDER_SAMPLE==='true'){mkdirSync('.codex_tmp',{recursive:true});writeFileSync('.codex_tmp/spin-sample.pdf',buffer);}
 },15000);
 it('separates processing and marketing consent, with indefinite retention notice',()=>{expect(SPIN_NOTICE_VERSION).toContain('indefinite');});
});
