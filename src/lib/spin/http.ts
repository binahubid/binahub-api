import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCorsHeaders } from '@/lib/cors';
import { createServerSupabase } from '@/lib/supabase';
import { SpinAnswerSchema,SpinError,SpinWriteSchema } from './intake';
export const spinHeaders={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','X-Content-Type-Options':'nosniff'};
export const spinJson=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:spinHeaders});
// A second whitelist at the API boundary protects against accidental RPC/schema drift.
const draftDTO=z.object({id:z.uuid(),answers:SpinAnswerSchema,confirmation:SpinWriteSchema.shape.confirmation,
 revision:z.number().int().nonnegative(),status:z.enum(['draft','queued','processing','ready','failed']),
 createdAt:z.string().optional(),updatedAt:z.string().optional(),submittedAt:z.string().nullable().optional()});
export function spinDraft(value:unknown){const parsed=draftDTO.safeParse(value);if(!parsed.success)throw new SpinError('SPIN_STORAGE_UNAVAILABLE');return parsed.data;}
export function spinOrigin(req:NextRequest) {
 const origin=req.headers.get('origin');
 if(origin&&!getCorsHeaders(origin)['Access-Control-Allow-Origin'])throw new SpinError('SPIN_FORBIDDEN');
}
export async function spinBody(req:NextRequest) {
 spinOrigin(req);
 if(!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new SpinError('SPIN_INVALID_REQUEST');
 const reader=req.body?.getReader();if(!reader)throw new SpinError('SPIN_INVALID_REQUEST');
 const chunks:Uint8Array[]=[];let total=0;
 try {while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>32*1024){await reader.cancel();throw new SpinError('SPIN_TOO_LARGE');}chunks.push(value);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;}catch{throw new SpinError('SPIN_INVALID_REQUEST');}
 }finally{reader.releaseLock();}
}
export async function spinRPC(name:string,args:Record<string,unknown>={}) {
 const {data,error}=await createServerSupabase().rpc(name,args);
 if(error){const code=/\bSPIN_[A-Z_]+\b/.exec(error.message)?.[0];throw new SpinError(code||'SPIN_STORAGE_UNAVAILABLE');}
 return data;
}
export function spinFailure(error:unknown) {
 const code=error instanceof SpinError?error.code:error instanceof z.ZodError?'SPIN_INVALID_REQUEST':'SPIN_SERVICE_UNAVAILABLE';
 const map:Record<string,[number,string]>={
 SPIN_INVALID_REQUEST:[400,'Permintaan tidak valid. Periksa kembali isian Anda.'],
 SPIN_ANSWERS_INVALID:[422,'Periksa jawaban, batas pilihan, dan informasi pribadi pada isian.'],
 SPIN_SUMMARY_CHANGED:[409,'Jawaban berubah. Tinjau dan konfirmasi kembali ringkasan kebutuhan Anda.'],
 SPIN_CONFIRMATION_REQUIRED:[422,'Konfirmasi ringkasan dan hal yang perlu diselaraskan sebelum mengirim.'],
 SPIN_CHALLENGE_INVALID:[422,'Jawaban verifikasi belum tepat. Periksa penjumlahan dan coba lagi.'],
 SPIN_NOT_FOUND:[404,'Akses tidak ditemukan atau sudah berakhir. Gunakan tautan baru dari email.'],
 SPIN_LINK_EXPIRED:[410,'Tautan sudah digunakan atau kedaluwarsa. Minta tautan baru.'],
 SPIN_REVISION_CONFLICT:[409,'Draft berubah di tab lain. Muat ulang sebelum melanjutkan.'],
 SPIN_FINALIZED:[409,'Pengisian sudah terkirim dan tidak dapat diubah.'],
 SPIN_FORBIDDEN:[403,'Permintaan tidak diizinkan.'],
 SPIN_TOO_LARGE:[413,'Isian terlalu panjang. Ringkas jawaban Anda.'],
 SPIN_SETUP_REQUIRED:[503,'Layanan rekomendasi sedang disiapkan. Silakan coba lagi nanti.'],
 SPIN_INVALID_REPORT:[503,'Laporan belum dapat dibaca. Silakan coba lagi atau hubungi admin@binahub.id.'],
 };
 const [status,message]=map[code]||[503,'Layanan belum dapat diakses. Jawaban yang sudah tersimpan tetap tersedia. Coba lagi sebentar.'];
 if(status>=500)console.error('[SPIN] SERVICE_UNAVAILABLE');
 return spinJson({success:false,code:map[code]?code:'SPIN_SERVICE_UNAVAILABLE',error:message},status);
}
