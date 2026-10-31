import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { Resend } from 'resend';
import { createServerSupabase } from '@/lib/supabase';
import { resolvePublicAppUrl } from '@/lib/public-app-url';
import { spinRPC } from './http';
import { SPIN_DEFINITION, SpinError, spinHash, spinConfirmedNeeds, validateSpinAnswers } from './intake';
import { prepareSpinRecommendation } from './service';
import { buildSpinReport, SpinReportSchema } from './report';
import { renderSpinPDF } from './pdf';
import { type SpinAnswers } from './form';

export function spinConfigured(){return !!(process.env.PROPOSAL_LINK_SECRET&&process.env.PROPOSAL_LINK_SECRET.length>=32&&process.env.RESEND_API_KEY&&process.env.EMAIL_FROM?.includes('@')&&!process.env.EMAIL_FROM.includes('resend.dev'));}
export const spinRandomKey=()=>randomBytes(32).toString('hex');
export function spinLinkKey(job:string) {
 if(!process.env.PROPOSAL_LINK_SECRET||process.env.PROPOSAL_LINK_SECRET.length<32)throw new SpinError('SPIN_SETUP_REQUIRED');
 return createHmac('sha256',process.env.PROPOSAL_LINK_SECRET).update('spin/report-link/v1/'+job).digest('hex');
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function spinEmail(name:string,url:string) {
 return '<div style="background:#f7f8fa;padding:32px 16px;font-family:Arial,sans-serif;color:#0b2c6b"><div style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:12px"><p style="font-size:21px;font-weight:bold">BinaHub</p><h1 style="font-size:24px">Rekomendasi pengembangan Anda telah tersedia</h1><p style="line-height:1.7">Yth. '+escape(name)+', terima kasih telah berbagi kebutuhan organisasi Anda. Laporan terlampir memuat ringkasan kebutuhan, rekomendasi awal, dan langkah berikutnya.</p><p><a style="display:inline-block;padding:14px 20px;background:#0b2c6b;border-radius:8px;color:white;text-decoration:none" href="'+escape(url)+'">Lihat rekomendasi Anda</a></p><p style="font-size:13px;line-height:1.7">Tautan pribadi berlaku 48 jam dan sekali pakai. Setelah dibuka, sesi tersedia 30 menit. Jangan teruskan tautan; gunakan PDF untuk pembahasan internal. Anda dapat meminta tautan baru dari halaman laporan.</p><p>Salam profesional,<br>Tim BinaHub</p><p style="font-size:12px">Bantuan: admin@binahub.id</p></div></div>';
}
type Work={id:string;lease:string;answers:SpinAnswers;summary:{situation:string;problem:string;impact:string;outcome:string};confirmation:{status:'confirmed'|'edited'|'supplemented'};contact:{name:string;email:string;company:string};submitted_at:string};
type Mail={id:string;submission_id:string;lease:string;recipient:string;from_address:string;app_origin:string;name:string;report:unknown;link_hash:string|null};
export async function processSpinWork(id?:string) {
 if(!spinConfigured())return {processed:false,status:'setup_required'};
 const row=await spinRPC('spin_claim',{p_id:id||null}) as Work|null;
 let stage='answers';
 if(row)try {
   const answers=validateSpinAnswers(row.answers,true),needs=spinConfirmedNeeds(answers,row.confirmation,row.summary);
   stage='analysis';
   const selection=await prepareSpinRecommendation(needs);
   // Provider/schema failure is retryable work, not a completed consultation report.
   // A valid AI response with no supported match still follows the consultation path.
   if(selection.internalConsultant.consultationReasons.includes('AI_MATCH_UNAVAILABLE'))throw new Error('SPIN_ANALYSIS_PENDING');
   stage='report';
   const report=buildSpinReport({id:row.id,submittedAt:row.submitted_at,company:row.contact.company,answers,summary:row.summary,status:row.confirmation.status,selection,bookingUrl:process.env.CALCOM_BOOKING_URL});
   stage='persist';
   if(await spinRPC('spin_finish',{p_id:row.id,p_lease:row.lease,p_report:report.publicReport,p_internal:report.internal,p_error:null})!==true)throw new Error('LEASE_LOST');
 }catch{
   // Stage only: never log contact, answers, links, model output or raw errors.
   console.error('[SPIN] PROCESSING_RETRY stage='+stage);
   await spinRPC('spin_finish',{p_id:row.id,p_lease:row.lease,p_report:null,p_internal:null,p_error:'SPIN_PROCESSING_RETRY'});
   return {processed:true,status:'pending'};
 }
 return processSpinMail(id);
}
export async function processSpinMail(id?:string) {
 if(!spinConfigured())return {processed:false,status:'setup_required'};
 const mail=await spinRPC('spin_claim_mail',{p_id:id||null,p_from:process.env.EMAIL_FROM,p_origin:resolvePublicAppUrl()}) as Mail|null;
 if(!mail)return {processed:false};
 let accepted=false;
 try{
  const report=SpinReportSchema.parse(mail.report),key=spinLinkKey(mail.id),hash=spinHash(key);
  if(mail.link_hash&&mail.link_hash!==hash)throw new SpinError('SPIN_SETUP_REQUIRED');
  const url=mail.app_origin+'/discovery/result?id='+encodeURIComponent(mail.submission_id)+'#link='+mail.id+'&access='+key;
  const rendered=await renderSpinPDF(report);
  const frozenPDF=await spinRPC('spin_prepare_mail',{p_id:mail.id,p_lease:mail.lease,p_hash:hash,p_pdf:rendered.toString('base64')});
  if(typeof frozenPDF!=='string')throw new Error('LEASE_LOST');
  const pdf=Buffer.from(frozenPDF,'base64');
  const response=await new Resend(process.env.RESEND_API_KEY).emails.send({
   from:mail.from_address,to:mail.recipient,subject:'Rekomendasi pengembangan organisasi Anda — BinaHub',
   html:spinEmail(mail.name,url),text:'Yth. '+mail.name+', laporan rekomendasi awal Anda terlampir. Akses pribadi (48 jam, sekali pakai): '+url+'\nBantuan: admin@binahub.id.',
   attachments:[{filename:'BinaHub-Rekomendasi-Pengembangan.pdf',content:pdf}],tags:[{name:'category',value:'spin_discovery'}],
  },{idempotencyKey:'spin-report-'+mail.id});
  if(response.error||!response.data?.id)throw new Error('SEND_FAILED');
  accepted=true;
  if(await spinRPC('spin_finish_mail',{p_id:mail.id,p_lease:mail.lease,p_provider:response.data.id})!==true)throw new Error('LEASE_LOST');
  return {processed:true,status:'sent'};
 }catch{
  // Stable body/sender/origin/link and key for retries within 23h. No recipient/provider details logged.
  if(!accepted)await spinRPC('spin_finish_mail',{p_id:mail.id,p_lease:mail.lease,p_provider:null});
  console.error('[SPIN] EMAIL_RETRY');
  return {processed:true,status:'pending'};
 }
}
export async function spinAvailability(){
 if(!spinConfigured())return false;
 const {error}=await createServerSupabase().from('spin_submissions').select('id').limit(0);
 return !error&&SPIN_DEFINITION.fields.length>0;
}
