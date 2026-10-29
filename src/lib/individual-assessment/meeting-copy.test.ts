import {describe,it,expect} from 'vitest';
import {peParticipantPrompt,peParticipantQuestion,peParticipantOption} from './meeting-copy';
describe('owner public wording revision without score/key changes',()=>{
 it('uses participant choice wording across all six free SJT items without changing other items',()=>{
  for(const id of ['SJ03','SJ04','SJ07','SJ08','SJ11','SJ12']){
   expect(peParticipantQuestion(id,'Apa tindakan yang paling efektif?')).toBe('Apa tindakan yang Anda pilih?');
   expect(peParticipantQuestion(id,'Apa respons paling efektif?')).toBe('Apa respons yang Anda pilih?');
   expect(peParticipantQuestion(id,'Apa tindakan yang Anda pilih?')).toBe('Apa tindakan yang Anda pilih?');
  }
  expect(peParticipantQuestion('SJ01','Apa tindakan yang paling efektif?')).toBe('Apa tindakan yang paling efektif?');
 });
 it('edits only the intended source IDs and selected option wording',()=>{
  expect(peParticipantPrompt('SR21','saya tetap memusatkan perhatian')).toBe('saya tetap dapat memusatkan perhatian');
  expect(peParticipantPrompt('SR23','saya tetap memeriksa kualitas')).toBe('saya tetap dapat memeriksa kualitas');
  expect(peParticipantPrompt('SR05','saya tetap belajar')).toBe('saya tetap belajar');
  expect(peParticipantQuestion('SJ03','Apa tindakan yang paling efektif?')).toBe('Apa tindakan yang Anda pilih?');
  expect(peParticipantOption('SJ07','C','Pindah tugas tanpa koordinasi.')).toBe('Pindah tugas.');
  expect(peParticipantOption('SJ11','C','Menilai urgensi dan dampak, lalu berkomunikasi.')).toBe('Menilai urgensi dan dampak/kepentingan, lalu berkomunikasi.');
  expect(peParticipantOption('SJ11','A','Pilihan lain.')).toBe('Pilihan lain.');
 });
});
