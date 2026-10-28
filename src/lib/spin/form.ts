export type SpinValue = string | number | string[];
export type SpinAnswers = Record<string, SpinValue>;
export type SpinOption = { value: string; label: string; exclusive?: boolean };
export type SpinField = { key: string; questionId: string; label: string; type: string; required: boolean; options?: SpinOption[]; optionGroups?: Record<string, SpinOption[]>; optionGroupKey?: string; commonOptions?: SpinOption[]; mirrorKey?: string; maxSelected?: number; maxLength?: number; max?: number; when?: {key: string; values: string[]} };
export type SpinDefinition = { version: string; stages: string[]; fields: SpinField[]; screens: string[][] };
export const SPIN_NOTICE_VERSION = 'spin-processing-indefinite-v1';
export const SPIN_PRIVACY_NOTICE = 'AI kami membantu mencocokkan kebutuhan Anda dengan program BinaHub, tanpa menyertakan nama, alamat email, atau nomor telepon dari kolom kontak dalam analisis. Hindari data pribadi dan informasi rahasia dalam jawaban. Tim BinaHub dapat meninjau pengisian untuk memberikan rekomendasi dan menindaklanjuti kebutuhan Anda. Anda dapat meminta akses untuk koreksi jawaban atau penghapusan data melalui admin@binahub.id.';
export const spinArray = (a:SpinAnswers,k:string) => Array.isArray(a[k]) ? a[k] as string[] : [];
export function spinFit(a: SpinAnswers) {
  const barriers=spinArray(a,'barriers'), reasons:string[]=[];
  if(a.problemCluster==='C0'||a.problemCluster==='other'||spinArray(a,'symptoms').includes('unknown')||a.outcomeHelp==='help')reasons.push('E');
  if(['C9','C10'].includes(String(a.problemCluster))||a.programScope==='organization'||Number(a.participantCount)>150)reasons.push('D');
  if(barriers.filter(k=>['B1','B2','B4','B5','B7'].includes(k)).length>=2)reasons.push('C');
  if(barriers.some(k=>['B3','B6'].includes(k))||['no_impact','reverted'].includes(String(a.priorOutcome)))reasons.push('B');
  return reasons.length?reasons:['A'];
}
function derived(a:SpinAnswers,key:string): SpinValue | undefined {
  const fit=spinFit(a), approaches=spinArray(a,'approaches');
  if(key==='$delivery')return fit.some(x=>x==='A'||x==='B')||approaches.some(x=>['A1','A2','A3','A6'].includes(x))?'yes':'no';
  if(key==='$prior')return spinArray(a,'priorEfforts').some(x=>!['P8','P9'].includes(x))?'yes':'no';
  if(key==='$venue')return derived(a,'$delivery')==='yes'&&['onsite','hybrid'].includes(String(a.deliveryMode))&&(approaches.includes('A2')||a.problemCluster==='C2')?'yes':'no';
  if(key==='$owner')return fit.includes('B')||approaches.includes('A6')?'yes':'no';
  if(key==='$spiritual')return a.showSpiritual==='yes'||/\b(spiritual|ibadah|umrah)\b/i.test(['businessContext','example','desiredOutcome'].map(k=>a[k]||'').join(' '))?'yes':'no';
  return a[key];
}
export function spinOptions(f:SpinField,a:SpinAnswers) {
  let options=f.optionGroups? [...(f.optionGroups[String(a[f.optionGroupKey!])]||[]),...(f.commonOptions||[])]:f.options||[];
  options=options.filter((o,i)=>options.findIndex(p=>p.value===o.value)===i);
  return f.mirrorKey?options.filter(o=>!/^I[1-8]$/.test(o.value)||spinArray(a,f.mirrorKey!).includes(o.value)):options;
}
export function spinVisible(f:SpinField,a:SpinAnswers) {
  if(!f.when)return true;
  const value=derived(a,f.when.key);
  return Array.isArray(value)?value.some(x=>f.when!.values.includes(x)):f.when.values.includes(String(value));
}
export function spinSanitize(def:SpinDefinition,a:SpinAnswers) {
  const active:SpinAnswers={};if(a.showSpiritual==='yes')active.showSpiritual='yes';
  for(const f of def.fields)if(spinVisible(f,active)&&a[f.key]!==undefined&&a[f.key]!=='')active[f.key]=a[f.key];
  return active;
}
export const spinPersonalPattern=/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b\d(?:[\s().-]*\d){8,}\b|\bBearer\s+|\b(?:api[_ -]?key|password|secret|token)\s*[:=]/i;
export function spinErrors(def:SpinDefinition,raw:SpinAnswers,required=true,questions?:string[]) {
  const a=spinSanitize(def,raw), errors:Record<string,string>={};
  for(const f of def.fields){
    if(questions&&!questions.includes(f.questionId)||!spinVisible(f,a))continue;
    const v=a[f.key], empty=v===undefined||v===''||Array.isArray(v)&&v.length===0;
    if(empty){if(required&&f.required)errors[f.key]='Lengkapi bagian ini terlebih dahulu.';continue;}
    if(f.type==='number'){if(typeof v!=='number'||!Number.isInteger(v)||v<1||v>(f.max||100000))errors[f.key]='Gunakan angka bulat positif yang sesuai.';}
    else if(f.type==='text'){if(typeof v!=='string'||!v.trim()||v.length>(f.maxLength||500))errors[f.key]='Periksa panjang dan isi jawaban Anda.';
      else if(spinPersonalPattern.test(v))errors[f.key]='Hapus email, nomor identitas/telepon, tautan atau kunci rahasia dari jawaban ini.';}
    else {
      const values=Array.isArray(v)?v:[v], options=spinOptions(f,a);
      if(f.type==='multi'?!Array.isArray(v):typeof v!=='string')errors[f.key]='Pilih jawaban yang tersedia.';
      else if(values.some(x=>!options.some(o=>o.value===x))||new Set(values).size!==values.length)errors[f.key]='Pilih jawaban yang tersedia.';
      else if(f.type==='multi'&&(values.length>(f.maxSelected||99)||values.length>1&&values.some(x=>options.find(o=>o.value===x)?.exclusive)))errors[f.key]='Periksa batas pilihan; pilihan belum tahu/tidak ada harus berdiri sendiri.';
    }
  }
  return errors;
}
export function spinLabel(def:SpinDefinition,a:SpinAnswers,key:string) {
  const f=def.fields.find(f=>f.key===key),value=a[key];if(value===undefined||value==='')return 'Belum ditentukan';
  if(!f)return String(value);
  if(f.type==='text'||f.type==='number')return String(value);
  return (Array.isArray(value)?value:[value]).map(v=>spinOptions(f,a).find(o=>o.value===v)?.label||'Belum ditentukan').join('; ');
}
export function spinSummary(def:SpinDefinition,a:SpinAnswers) {
  const label=(k:string)=>spinLabel(def,a,k);
  return {
    situation:[label('role'),label('industry'),a.orgSize&&a.orgSize!=='SZ5'?label('orgSize').replace(/\.$/,'')+' karyawan':label('orgSize'),label('trigger'),label('audienceGroups'),a.participantCount?label('participantCount')+' target peserta':'Jumlah target peserta belum ditentukan'].join(' · '),
    problem:[label('problemCluster'),label('symptoms'),a.example||'',label('priorEfforts'),a.priorOutcome?label('priorOutcome'):'',label('barriers')].filter(Boolean).join(' · '),
    impact:[label('effects'),label('implications'),label('impactScope'),label('impactFrequency')].join(' · '),
    outcome:[a.outcomeHelp==='help'?'Sasaran awal perlu dibahas bersama.':label('desiredOutcome'),label('benefits'),label('successMeasures')].join(' · '),
  };
}
export function spinConflicts(a:SpinAnswers) {
  return [
    spinArray(a,'effects').includes('E8')&&spinArray(a,'implications').some(x=>x!=='unknown')?'impact':null,
    a.priority==='high'&&['6_plus','unknown'].includes(String(a.timeline))?'timing':null,
    Number(a.participantCount)>150&&a.programScope==='one_team'?'headcount':null,
    spinFit(a).includes('C')&&spinArray(a,'approaches').length===1&&spinArray(a,'approaches')[0]==='A1'?'training_only':null,
  ].filter((x):x is string=>x!==null);
}
export function spinStage(screen:number){return screen<3?0:screen<8?1:screen<11?2:screen<14?3:4;}
