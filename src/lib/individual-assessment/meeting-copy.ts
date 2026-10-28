export const PE_PARTICIPANT_COPY_VERSION='pe-owner-copy-2026-10-28-v1';
/** Public wording only; private source, answer IDs and credits stay immutable. */
export function peParticipantPrompt(id:string,text:string){
 return ['SR21','SR23'].includes(id)?text.replace(/saya tetap (?!dapat )/,'saya tetap dapat '):text;
}
export function peParticipantQuestion(id:string,text:string){
 return id==='SJ03'?text.replace('Apa tindakan yang paling efektif?','Apa tindakan yang Anda pilih?'):text;
}
export function peParticipantOption(id:string,option:string,text:string){
 if(id==='SJ07'&&option==='C')return text.replace(' tanpa koordinasi','');
 if(id==='SJ11'&&option==='C')return text.replace('Menilai urgensi dan dampak,','Menilai urgensi dan dampak/kepentingan,');
 return text;
}
