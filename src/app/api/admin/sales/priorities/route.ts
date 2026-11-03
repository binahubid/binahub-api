import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
const Query=z.object({page:z.coerce.number().int().min(0).max(10000).default(0),
  search:z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/).default(''),
  view:z.enum(['all','followup']).default('all'),kind:z.enum(['all','inquiry','assessment','proposal','followup','pipeline']).default('all')}).strict();
const json=(body:object,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'}});
export async function GET(req:NextRequest){
  try{
    const admin=await requireAdmin(req);if('error' in admin)return json({success:false,error:'Sesi admin tidak tersedia.'},admin.status);
    const limited=await enforceRateLimit(req,'admin-sales-priorities',300,3600);if(limited)return limited;
    const params=req.nextUrl.searchParams;
    if(new Set(params.keys()).size!==params.size)return json({success:false,error:'Filter prioritas tidak valid.'},400);
    const input=Query.parse(Object.fromEntries(params));
    const {data,error}=await createServerSupabase().rpc('admin_sales_priorities',{p_page:input.page,p_search:input.search,p_view:input.view,p_kind:input.kind});
    if(error)return json({success:false,error:error.code==='PGRST202'||error.code==='42883'?'Prioritas CRM memerlukan SQL86. Hubungi pengelola untuk menyelesaikan pembaruan.':'Prioritas CRM belum dapat dimuat. Silakan coba lagi.'},503);
    if(!data||data.version!==1||data.page!==input.page||data.pageSize!==20||!Array.isArray(data.records)||data.records.length>20||!Number.isSafeInteger(data.total)||data.total<0)
      return json({success:false,error:'Respons prioritas CRM belum tersedia.'},503);
    return json({success:true,...data});
  }catch(error){return json({success:false,error:error instanceof z.ZodError?'Periksa kembali filter prioritas.':'Prioritas CRM belum dapat dimuat. Silakan coba lagi.'},error instanceof z.ZodError?400:503);}
}
