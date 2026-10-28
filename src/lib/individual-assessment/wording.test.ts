import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('server-only',()=>({}));
const ai=vi.hoisted(()=>vi.fn());vi.mock('@/lib/ai-provider',()=>({callRoutedAI:ai}));
import {validatePEWording,buildPEPublicWording} from './wording';
import {makeSyntheticPEInstrument} from './synthetic-fixture';
import type {PEDeliveryAttempt} from './delivery-contracts';
const anchors=[{code:'PE-02',action:'Menganalisis pengalaman sebelumnya untuk menemukan cara kerja yang lebih tepat'}];
beforeEach(()=>ai.mockReset());
describe('private behavior wording boundary',()=>{
 it('sends no participant identity, context, responses or scores and recovers from provider failure',async()=>{
  const attempt={context:{role:'PRIVATE_ROLE',goal:'PRIVATE_GOAL'},responses:{SR05:4},result:{competencies:[{code:'PE-02'}]}} as unknown as PEDeliveryAttempt;
  ai.mockResolvedValue({content:JSON.stringify({items:[{code:'PE-02',focus:'Setelah menyelesaikan tugas, catat satu hal yang ingin Anda coba dengan pendekatan berbeda.'}]})});
  expect(await buildPEPublicWording(attempt,makeSyntheticPEInstrument())).toHaveProperty('PE-02');
  const request=JSON.stringify(ai.mock.calls[0][0]);expect(request).not.toMatch(/PRIVATE_ROLE|PRIVATE_GOAL|SR05|responses|scores/);
 });
 it('uses public fallback on invalid provider output',async()=>{
  const attempt={responses:{SR05:4},result:{competencies:[{code:'PE-02'}]}} as unknown as PEDeliveryAttempt;
  ai.mockResolvedValue({content:'invalid JSON'});
  const result=await buildPEPublicWording(attempt,makeSyntheticPEInstrument());
  expect(result).toEqual({});
 });
 it('accepts rewritten practice, rejects copied anchors, references, invented codes and extra fields',()=>{
  expect(validatePEWording(JSON.stringify({items:[{code:'PE-02',focus:'Setelah menyelesaikan tugas, catat satu hal yang ingin Anda coba dengan pendekatan berbeda.'}]}),anchors)['PE-02']).toContain('catat');
  for(const item of [{code:'PE-02',focus:anchors[0].action},{code:'PE-02',focus:'Gunakan key action KA02.1 untuk memahami skor Anda.'},{code:'PE-06',focus:'Setelah menyelesaikan tugas, catat satu hal yang ingin Anda ubah.'}])expect(()=>validatePEWording(JSON.stringify({items:[item]}),anchors)).toThrow();
  expect(()=>validatePEWording(JSON.stringify({items:[],score:50}),anchors)).toThrow();
 });
});
