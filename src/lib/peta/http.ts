import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {requireAdmin} from '@/lib/admin-auth';
import {enforceRateLimit} from '@/lib/rate-limit';
import {createServerSupabase} from '@/lib/supabase';
import {PetaError,PetaToken} from './contracts';
import {openKey} from '../../../scripts/lib/peta-source.mjs';
export const petaHeaders={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:petaHeaders});
export const key=()=>randomBytes(32).toString('hex');
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const db=()=>createServerSupabase();
export async function rpc(name:string,args:Record<string,unknown>={}){
 const {data,error}=await db().rpc(name,args);if(error){const code=error.message?.match(/PETA_[A-Z_]+/)?.[0];throw new PetaError(code||'PETA_SETUP_REQUIRED');}return data;
}
export function originAllowed(req:NextRequest){
 const origin=req.headers.get('origin');if(!origin)return false;
 const allowed=new Set(['https://app.binahub.id',process.env.PETA_APP_ORIGIN].filter(Boolean));
 if(allowed.has(origin))return true;
 return process.env.NODE_ENV!=='production'&&/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(origin);
}
export async function guard(req:NextRequest,admin=false){
 if(req.method!=='GET'&&!originAllowed(req))return json({success:false,code:'PETA_ORIGIN_DENIED',error:'Permintaan tidak diizinkan.'},403);
 if(req.headers.get('origin')&&!originAllowed(req))return json({success:false,code:'PETA_ORIGIN_DENIED',error:'Permintaan tidak diizinkan.'},403);
 if(admin){const actor=await requireAdmin(req);if('error'in actor)return json({success:false,error:'Akses admin diperlukan.'},actor.status);
  const limited=await enforceRateLimit(req,'peta-admin-'+actor.userId,600,3600);return limited||{actor:actor.userId};}
 // Shared office IPs must not combine every participant's answer budget.
 const cap=PetaToken.safeParse(req.cookies.get('peta_session')?.value);
 const network=await enforceRateLimit(req,'peta-network',6000,3600);if(network)return network;
 const scope=cap.success?'peta-session-'+hash(cap.data).slice(0,24):'peta-entry';
 const limited=await enforceRateLimit(req,scope+(req.method==='GET'?'-read':'-write'),cap.success?600:120,3600);return limited||{actor:null};
}
export async function body(req:NextRequest,{allowEmpty=false}:{allowEmpty?:boolean}={}){
 const isJson=req.headers.get('content-type')?.toLowerCase().startsWith('application/json');
 if(!isJson&&!allowEmpty)throw new PetaError('PETA_INVALID_REQUEST');
 const reader=req.body?.getReader();
 if(!reader){if(allowEmpty)return {};throw new PetaError('PETA_INVALID_REQUEST');}
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();throw new PetaError('PETA_BODY_TOO_LARGE');}chunks.push(value);}
  // Proxy adapters may expose a stream even when the request has zero bytes.
  // Only explicitly body-optional endpoints may treat that as an empty object.
  if(allowEmpty&&size===0)return {};
  if(!isJson)throw new PetaError('PETA_INVALID_REQUEST');
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PetaError('PETA_INVALID_REQUEST');}
 }finally{reader.releaseLock();}
}
export function credential(req:NextRequest,write=false){
 const token=PetaToken.safeParse(req.cookies.get('peta_session')?.value),csrf=PetaToken.safeParse(req.cookies.get('peta_csrf')?.value);
 if(!token.success||!csrf.success)throw new PetaError('PETA_SESSION_REQUIRED');
 if(write&&req.headers.get('x-csrf-token')!==csrf.data)throw new PetaError('PETA_SESSION_REQUIRED');
 return {hash:hash(token.data),csrfHash:hash(csrf.data),csrfToken:csrf.data};
}
export function revision(req:NextRequest){const value=req.headers.get('if-match');if(!value||!/^"?[0-9]{1,9}"?$/.test(value))throw new PetaError('PETA_INVALID_REQUEST');return Number(value.replaceAll('"',''));}
export function cookies(res:NextResponse,token:string,csrf:string){for(const [name,value]of [['peta_session',token],['peta_csrf',csrf]])res.cookies.set(name,value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/peta',maxAge:8*3600});return res;}
export async function source(){
 const {data,error}=await db().from('peta_instruments').select('public_payload,sealed_key,key_fingerprint,public_sha256').eq('instrument_id','PETA-DISC-FC24').eq('version','1.0.0-pilot').maybeSingle();
 if(error||!data||data.public_payload?.contentSha256!==data.public_sha256)throw new PetaError('PETA_SETUP_REQUIRED');
 const privateKey=openKey(data.public_payload,data.sealed_key,data.key_fingerprint,process.env.PETA_ENCRYPTION_KEY);
 return {mapping:privateKey.optionToDimension};
}
export function failure(error:unknown){
 const code=error instanceof z.ZodError?'PETA_INVALID_REQUEST':error instanceof PetaError?error.code:error instanceof Error&&/^PETA_[A-Z_]+$/.test(error.message)?error.message:'PETA_UNAVAILABLE';
 const errors:Record<string,[number,string]>={PETA_INVALID_REQUEST:[400,'Periksa kembali isian Anda.'],PETA_BODY_TOO_LARGE:[413,'Permintaan terlalu besar.'],PETA_LINK_EXPIRED:[410,'Tautan tidak berlaku atau sudah digunakan. Hubungi penyelenggara untuk akses baru.'],PETA_CONSENT_REQUIRED:[422,'Persetujuan penggunaan data diperlukan.'],PETA_SESSION_REQUIRED:[401,'Sesi berakhir atau tidak tersedia. Minta tautan pemulihan dari penyelenggara.'],PETA_NOT_FOUND:[404,'Data tidak tersedia atau Anda tidak memiliki akses.'],PETA_REVISION_CONFLICT:[412,'Jawaban berubah di tab lain. Pilihan pada layar ini belum disimpan; muat versi terbaru sebelum melanjutkan.'],PETA_INVALID_ANSWER:[422,'Pilih dua pernyataan yang berbeda.'],PETA_FINALIZED:[409,'Jawaban sudah dikirim atau akses telah dicabut.'],PETA_INCOMPLETE:[422,'Lengkapi seluruh 24 situasi sebelum mengirim.'],PETA_RESULT_NOT_READY:[409,'Hasil tersedia setelah seluruh jawaban dikirim.'],PETA_SETUP_REQUIRED:[503,'PETA sedang disiapkan. Hubungi penyelenggara.'],PETA_SOURCE_INVALID:[503,'Sumber PETA perlu diperiksa. Jawaban tersimpan tidak diubah.']};
 const [status,message]=errors[code]||[503,'PETA belum dapat dihubungi. Jawaban yang sudah tersimpan tetap tersedia.'];return json({success:false,code:errors[code]?code:'PETA_UNAVAILABLE',error:message},status);
}
