import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
const Query = z.object({ page: z.coerce.number().int().min(0).max(10000).default(0), search: text(150).default(''),
  view: z.enum(['all', 'upcoming', 'today', 'history', 'cancelled', 'review']).default('upcoming'), status: text(100).default('') }).strict();
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
} });
const failure = (code?: string) => json({ success: false, error: code === 'PGRST202' || code === '42883'
  ? 'Arsip konsultasi memerlukan SQL87. Hubungi pengelola untuk menyelesaikan pembaruan.'
  : 'Konsultasi belum dapat dimuat. Silakan coba lagi.' }, 503);

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    if ('error' in admin) return json({ success: false, error: 'Sesi admin tidak tersedia.' }, admin.status);
    const limited = await enforceRateLimit(req, 'admin-meetings-inbox', 300, 3600);
    if (limited) return limited;
    const params = req.nextUrl.searchParams;
    if (new Set(params.keys()).size !== params.size) return json({ success: false, error: 'Filter konsultasi tidak valid.' }, 400);
    if (params.has('id')) {
      const { id } = z.object({ id: z.string().uuid() }).strict().parse(Object.fromEntries(params));
      const { data, error } = await createServerSupabase().rpc('admin_meeting_detail', { p_id: id });
      if (error) return failure(error.code);
      if (!data) return json({ success: false, error: 'Jadwal tidak ditemukan. Perbarui daftar.' }, 404);
      if (data.id !== id) return failure();
      return json({ success: true, record: data });
    }
    const input = Query.parse(Object.fromEntries(params));
    const { data, error } = await createServerSupabase().rpc('admin_meetings_inbox', {
      p_page: input.page, p_search: input.search, p_view: input.view, p_status: input.status,
    });
    if (error) return failure(error.code);
    if (!data || data.version !== 1 || data.page !== input.page || data.pageSize !== 20 || data.timeZone !== 'Asia/Jakarta'
      || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.records) || data.records.length > 20) return failure();
    return json({ success: true, ...data });
  } catch (error) {
    return error instanceof z.ZodError ? json({ success: false, error: 'Periksa kembali filter konsultasi.' }, 400) : failure();
  }
}
