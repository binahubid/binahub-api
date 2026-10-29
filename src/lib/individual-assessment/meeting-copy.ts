export const PE_PARTICIPANT_COPY_VERSION='pe-owner-copy-2026-10-29-v2';
/** Public wording only; private source, answer IDs and credits stay immutable. */
export function peParticipantPrompt(id:string,text:string){
 return ['SR21','SR23'].includes(id)?text.replace(/saya tetap (?!dapat )/,'saya tetap dapat '):text;
}
export function peParticipantQuestion(id:string,text:string){
 return ['SJ03','SJ04','SJ07','SJ08','SJ11','SJ12'].includes(id)
  ? text.replace(/(?:yang\s+)?paling efektif/gi,'yang Anda pilih') : text;
}
export function peParticipantOption(id:string,option:string,text:string){
 if(id==='SJ07'&&option==='C')return text.replace(' tanpa koordinasi','');
 if(id==='SJ11'&&option==='C')return text.replace('Menilai urgensi dan dampak,','Menilai urgensi dan dampak/kepentingan,');
 return text;
}
