import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

const text = z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/);
const page = z.coerce.number().int().min(0).max(10000);
const Query = z.object({
  page: page.default(0), search: text.default(''), view: z.enum(['active','won','lost','review']).default('active'),
  priority: z.enum(['all','attention','overdue','unassigned','paused']).default('all'),
  owner: z.string().trim().max(320).regex(/^[^\u0000-\u001f\u007f]*$/).default(''), source: text.default(''),
  stage: z.enum(['','identified','qualified','consultation','proposal','negotiation']).default(''),
  sort: z.enum(['priority','value','newest']).default('priority'), tests: z.enum(['0','1']).default('0'),
}).strict();
const Detail = z.object({id:z.uuid(),historyPage:page.default(0)}).strict();
const json = (body:object,status=200) => NextResponse.json(body,{status,headers:{
  'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow',
}});

export async function GET(req:NextRequest) {
  try {
    const actor=await requireAdmin(req);
    if('error' in actor) return json({success:false,error:'Sesi admin tidak tersedia.'},actor.status);
    const limited=await enforceRateLimit(req,'admin-pipeline-inbox',300,3600); if(limited) return limited;
    const params=req.nextUrl.searchParams;
    if(new Set(params.keys()).size!==params.size) return json({success:false,error:'Filter peluang tidak valid.'},400);
    const input=Object.fromEntries(params);
    const query=params.has('id')?Detail.parse(input):Query.parse(input);
    const db=createServerSupabase();
    const {data,error}='id' in query
      ? await db.rpc('admin_pipeline_detail',{p_id:query.id,p_history_page:query.historyPage})
      : await db.rpc('admin_pipeline_inbox',{p_page:query.page,p_search:query.search,p_view:query.view,p_priority:query.priority,
        p_owner:query.owner,p_source:query.source,p_stage:query.stage,p_sort:query.sort,p_tests:query.tests==='1'});
    if(error) return json({success:false,error:error.code==='PGRST202'||error.code==='42883'
      ? 'Pipeline memerlukan SQL85. Hubungi pengelola untuk menyelesaikan pembaruan.'
      : 'Pipeline belum dapat dimuat. Silakan coba lagi.'},503);
    if('id' in query) {
      if(!data) return json({success:false,error:'Peluang tidak ditemukan. Perbarui daftar.'},404);
      if(data.record?.id!==query.id||data.context?.historyPage!==query.historyPage||!Array.isArray(data.context?.activities))
        return json({success:false,error:'Detail peluang belum tersedia.'},503);
      return json({success:true,...data});
    }
    if(!data||data.version!==1||data.page!==query.page||!Array.isArray(data.records)||data.records.length>20
      ||!Number.isSafeInteger(data.total)||data.total<0) return json({success:false,error:'Respons pipeline belum tersedia.'},503);
    return json({success:true,...data});
  } catch(error) {
    return json({success:false,error:error instanceof z.ZodError?'Periksa kembali filter peluang.':'Pipeline belum dapat dimuat. Silakan coba lagi.'},error instanceof z.ZodError?400:503);
  }
}
