import {describe,it,expect} from 'vitest';
import {peParticipantPrompt,peParticipantQuestion,peParticipantOption} from './meeting-copy';
describe('owner public wording revision without score/key changes',()=>{
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
