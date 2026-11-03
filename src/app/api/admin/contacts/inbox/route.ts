import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
const text=z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/);
const kind=z.enum(['lead','inquiry','coach','employee']);
const Query=z.object({page:z.coerce.number().int().min(0).max(10000).default(0),search:text.default(''),type:kind.or(z.literal('')).default(''),category:text.default(''),status:text.default('')}).strict();
const Detail=z.object({id:z.uuid(),type:kind}).strict();
const json=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
export async function GET(req:NextRequest){
  try{
    const actor=await requireAdmin(req);if('error'in actor)return json({success:false,error:'Sesi admin tidak tersedia.'},actor.status);
    const limited=await enforceRateLimit(req,'admin-contact-inbox',300,3600);if(limited)return limited;
    const params=req.nextUrl.searchParams;
    if(new Set(params.keys()).size!==params.size)return json({success:false,error:'Filter kontak tidak valid.'},400);
    const isDetail=params.has('id');
    const input=Object.fromEntries(params),db=createServerSupabase();
    const query=isDetail?Detail.parse(input):Query.parse(input);
    const {data,error}='id'in query?await db.rpc('admin_contact_detail',{p_type:query.type,p_id:query.id}):await db.rpc('admin_contact_inbox',{
      p_page:query.page,p_search:query.search,p_type:query.type,p_category:query.category,p_status:query.status,
    });
    if(error)return json({success:false,error:error.code==='PGRST202'||error.code==='42883'?'Daftar kontak memerlukan SQL84. Hubungi pengelola untuk menyelesaikan pembaruan.':'Kontak belum dapat dimuat. Silakan coba lagi.'},503);
    if(isDetail){if(!data)return json({success:false,error:'Kontak tidak ditemukan atau identitas utamanya berubah. Perbarui daftar.'},404);return json({success:true,record:data});}
    if(!data||data.version!==1||!Array.isArray(data.records)||!Number.isSafeInteger(data.total)||data.total<0)return json({success:false,error:'Respons daftar kontak belum tersedia.'},503);
    return json({success:true,...data});
  }catch(error){return json({success:false,error:error instanceof z.ZodError?'Periksa kembali filter kontak.':'Kontak belum dapat dimuat. Silakan coba lagi.'},error instanceof z.ZodError?400:503);}
}
