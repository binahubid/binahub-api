import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { inquiryDetailColumns, mapAdminInquiry, type AdminInquiryRow } from '@/lib/admin-inquiry-record';

const text = z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/);
const Query = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), search: text.default(''), source: text.default(''), status: text.default('') }).strict();
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
} });
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return json({ success: false, error: 'Sesi admin tidak tersedia.' }, actor.status);
    const limited = await enforceRateLimit(req, 'admin-inquiry-inbox', 300, 3600); if (limited) return limited;
    const params = req.nextUrl.searchParams;
    if (new Set(params.keys()).size !== params.size) return json({ success: false, error: 'Filter inquiry tidak valid.' }, 400);
    if (params.has('id')) {
      if (params.size !== 1) return json({ success: false, error: 'Permintaan detail tidak valid.' }, 400);
      const id = z.uuid().parse(params.get('id'));
      const { data, error } = await createServerSupabase().from('inquiries').select(inquiryDetailColumns).eq('id', id).maybeSingle();
      if (error) return json({ success: false, error: 'Detail inquiry belum dapat dimuat.' }, 503);
      if (!data) return json({ success: false, error: 'Inquiry tidak ditemukan.' }, 404);
      return json({ success: true, record: mapAdminInquiry(data as AdminInquiryRow) });
    }
    const query = Query.parse(Object.fromEntries(params));
    const { data, error } = await createServerSupabase().rpc('admin_inquiry_inbox', {
      p_page: query.page, p_search: query.search, p_source: query.source, p_status: query.status,
    });
    if (error) return json({ success: false, error: error.code === 'PGRST202' || error.code === '42883'
      ? 'Daftar inquiry memerlukan SQL83. Hubungi pengelola untuk menyelesaikan pembaruan.' : 'Daftar inquiry belum dapat dimuat. Silakan coba lagi.' }, 503);
    if (!data || data.version !== 1 || !Array.isArray(data.records) || !Number.isSafeInteger(data.total) || data.total < 0) return json({ success: false, error: 'Respons daftar inquiry belum tersedia.' }, 503);
    return json({ success: true, ...data });
  } catch (error) {
    return json({ success: false, error: error instanceof z.ZodError ? 'Periksa kembali filter inquiry.' : 'Inquiry belum dapat dimuat. Silakan coba lagi.' }, error instanceof z.ZodError ? 400 : 503);
  }
}
