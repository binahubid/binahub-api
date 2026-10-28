export const PUBLIC_COPY_VERSION='owner-public-copy-2026-10-28-v1';
/** Text nodes only: never rename API paths, email variables or link destinations. */
export function meetingPublicCopy(text:string){
 return text.replace(/\bDiagnosa\b/g,'Diagnosis').replace(/\bdiagnosa\b/g,'diagnosis')
  .replace(/\b(?:assessment|asesmen)\b/gi,'Self Diagnostic')
  .replace(/\b16\s+tahun\b/gi,'20 tahun lebih').replace(/\bmelalui\s+Bina Daya Nugraha\b/gi,'');
}
export function meetingPublicHtml(html:string){return html.split(/(<[^>]+>)/g).map((part,i)=>i%2?part:meetingPublicCopy(part)).join('');}
