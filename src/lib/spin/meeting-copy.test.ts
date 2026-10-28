import {describe,it,expect} from 'vitest';
import {SPIN_DEFINITION,SpinWriteSchema,SpinContactSchema} from './intake';
import {spinSummary} from './form';
describe('meeting-requested SPIN presentation',()=>{
 it('starts from the development trigger and includes the added industries',()=>{
  expect(SPIN_DEFINITION.screens[0]).toEqual(['Q02']);
  const labels=SPIN_DEFINITION.fields.find(f=>f.key==='industry')!.options!.map(o=>o.label);
  for(const label of ['Perkebunan','Pertanian','Perikanan','Transportasi dan logistik','Perhotelan','Pariwisata'])expect(labels).toContain(label);
 });
 it('keeps organization and participant units visible',()=>{
  const summary=spinSummary(SPIN_DEFINITION,{orgSize:'SZ4',participantCount:30});
  expect(summary.situation).toContain('1.000 karyawan');expect(summary.situation).toContain('30 target peserta');
 });
 it('requires role only on public submission while preserving old contact records',()=>{
  expect(SpinContactSchema.safeParse({name:'Test',email:'test@example.invalid',company:'Example'}).success).toBe(true);
  const submit={idempotencyKey:'a'.repeat(64),contact:{name:'Test',email:'test@example.invalid',company:'Example'},processingConsent:true,marketingConsent:false,noticeVersion:'spin-processing-indefinite-v1',conflictsAcknowledged:true,challengeAnswer:4,website:''};
  expect(SpinWriteSchema.safeParse({key:'b'.repeat(64),revision:0,answers:{},submit}).success).toBe(false);
  expect(SpinWriteSchema.safeParse({key:'b'.repeat(64),revision:0,answers:{},submit:{...submit,contact:{...submit.contact,role:'HR'}}}).success).toBe(true);
 });
});
