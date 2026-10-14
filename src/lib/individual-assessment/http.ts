import 'server-only';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromBearer } from '@/lib/auth-role';
import { enforceRateLimit } from '@/lib/rate-limit';
import { createServerSupabase } from '@/lib/supabase';
import { PEDeliveryError } from './delivery';

export const peHeaders={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export const peJson=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:peHeaders});
export async function requirePEOwner(req:NextRequest,write=false) {
  const auth=await getUserFromBearer(req);
  if('error' in auth)return peJson({success:false,code:'PE_SIGN_IN_REQUIRED',error:'Silakan masuk untuk mengakses hasil pribadi Anda.'},401);
  if(!auth.user.email_confirmed_at)return peJson({success:false,code:'PE_EMAIL_VERIFICATION_REQUIRED',error:'Verifikasi email Anda terlebih dahulu.'},403);
  const limited=await enforceRateLimit(req,`pe-${write?'write':'read'}-${auth.user.id}`,write?300:600,3600);
  if(limited)return limited;
  return {ownerId:auth.user.id,db:createServerSupabase()};
}
export async function readPEBody(req:NextRequest) {
  if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new PEDeliveryError('PE_INVALID_REQUEST');
  const reader=req.body?.getReader();if(!reader)throw new PEDeliveryError('PE_INVALID_REQUEST');
  const chunks:Uint8Array[]=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>16*1024){await reader.cancel();throw new PEDeliveryError('PE_BODY_TOO_LARGE');}chunks.push(value);}
    const buffer=Buffer.concat(chunks.map(c=>Buffer.from(c)));
    try{return JSON.parse(buffer.toString('utf8'));}catch{throw new PEDeliveryError('PE_INVALID_REQUEST');}
  }finally{reader.releaseLock();}
}
export function peFailure(error:unknown) {
  if(error instanceof z.ZodError)return peJson({success:false,code:'PE_INVALID_REQUEST',error:'Periksa kembali isian Anda.'},400);
  const code=error instanceof Error&&/^PE_[A-Z_]+$/.test(error.message)?error.message:'PE_SERVICE_UNAVAILABLE';
  const map:Record<string,[number,string]>={
    PE_ATTEMPT_NOT_FOUND:[404,'Pengisian tidak ditemukan atau masa aksesnya sudah berakhir.'],
    PE_START_CONFLICT:[409,'Pengisian ini sudah dibuat. Muat kembali draft Anda.'],
    PE_REVISION_CONFLICT:[409,'Draft berubah di tab lain. Muat versi terbaru sebelum melanjutkan.'],
    PE_ATTEMPT_FINALIZED:[409,'Jawaban sudah dikirim dan tidak dapat diubah.'],
    PE_ANSWERS_INCOMPLETE:[422,'Lengkapi semua soal sebelum mengirim jawaban.'],
    PE_ENTITLEMENT_REQUIRED:[403,'Soal tersebut belum termasuk dalam akses Anda.'],
    PE_CONSENT_REQUIRED:[422,'Persetujuan penggunaan asesmen perlu dikonfirmasi.'],
    PE_RESULT_NOT_READY:[409,'Hasil belum tersedia. Selesaikan pengisian terlebih dahulu.'],
    PE_INVALID_REQUEST:[400,'Permintaan tidak valid. Periksa isian Anda.'],
    PE_BODY_TOO_LARGE:[413,'Ukuran permintaan terlalu besar.'],
    PE_PILOT_PAUSED:[409,'Pengisian baru sedang dijeda. Draft dan hasil yang sudah tersimpan tetap dapat dibuka.'],
    PE_PILOT_SETUP_REQUIRED:[503,'Diagnosis individu sedang disiapkan. Silakan coba lagi nanti.'],
    PE_GUEST_SETUP_REQUIRED:[503,'Diagnosis individu sedang disiapkan. Silakan coba lagi nanti.'],
    PE_INVALID_REPORT:[503,'Laporan sedang disiapkan. Jawaban Anda tetap tersimpan.'],
    PE_LINK_EXPIRED:[410,'Tautan sudah digunakan atau kedaluwarsa. Minta tautan baru melalui email Anda.'],
    PE_EVALUATION_SAMPLE_SMALL:[409,'Data evaluasi belum mencapai lima pengisian dengan izin ekspor. Statistik ringkas tetap tersedia.'],
    PE_EXPORT_LIMIT:[409,'Data melebihi batas ekspor aman. Hubungi penanggung jawab evaluasi untuk ekspor terjadwal.'],
  };
  const [status,message]=map[code]||[503,'Asesmen individu belum dapat diakses. Silakan coba lagi nanti.'];
  if(status>=500)console.error('[Personal Effectiveness]',code); // Code only. Never log answers, PII, DB errors or keys.
  return peJson({success:false,code:map[code]?code:'PE_SERVICE_UNAVAILABLE',error:message},status);
}
