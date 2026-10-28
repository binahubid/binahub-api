import type {SpinDefinition} from './form';
/** Owner meeting revisions, 28 Oct 2026. Keep stable answer codes. */
export function applySpinMeetingCopy(input:SpinDefinition):SpinDefinition {
 const definition=structuredClone(input);
 const labels:Record<string,string>={
  trigger:'Apa yang paling mendorong perusahaan Anda mencari dukungan pengembangan saat ini?',
  audienceGroups:'Target kelompok utama yang akan dikembangkan',
  effects:'Di bagian mana kondisi tersebut sudah paling terasa dampaknya?',
  priorEfforts:'Apa yang sudah dicoba dilakukan perusahaan?',
  spiritualOptIn:'Jika relevan dengan kebutuhan Anda, apakah Anda ingin mengeksplorasi program pengembangan yang mengintegrasikan pengalaman spiritual (Umrah) dengan transformasi diri/tim?',
 };
 for(const field of definition.fields){
  if(labels[field.key])field.label=labels[field.key];
  field.label=field.label.replace(/\b(?:assessment|asesmen)\b/gi,'Self Diagnostic');
  for(const option of field.options||[])option.label=option.label.replace(/\b(?:assessment|asesmen)\b/gi,'Self Diagnostic');
  if(field.key==='industry')field.options=[...(field.options||[]),
   ...['Perkebunan','Pertanian','Perikanan','Transportasi dan logistik','Perhotelan','Pariwisata','Konstruksi dan properti','Pemerintahan dan layanan publik','Media dan industri kreatif'].map((label,i)=>({value:'IND'+(i+9),label}))];
 }
 // Lead with the reason for seeking help, then collect organization context.
 [definition.screens[0],definition.screens[1]]=[definition.screens[1],definition.screens[0]];
 return definition;
}
