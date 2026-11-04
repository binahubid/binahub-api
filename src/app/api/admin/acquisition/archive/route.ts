import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';

const text = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/);
const Query = z.object({
  kind: z.enum(['campaigns', 'prospects', 'deliveries', 'batches', 'events', 'journeys', 'journey_events']).default('campaigns'),
  campaignId: z.string().uuid().optional(), journeyId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0), search: text(150).default(''),
  status: text(100).default(''), channel: z.enum(['', 'inbound', 'outbound', 'partner', 'offline']).default(''),
}).strict().refine(v => (v.kind === 'campaigns' || !!v.campaignId)
  && (v.kind === 'journey_events' ? !!v.journeyId : !v.journeyId)
  && (v.kind === 'campaigns' || !v.channel));
const count = z.number().int().nonnegative().safe();
const Record = z.object({ id: z.string().uuid(), title: z.string(), subtitle: z.string(), context: z.string(), status: z.string(), occurredAt: z.string().nullable(),
  owner: z.string().optional(), channel: z.string().optional(), sourceChannel: z.string().optional(), sourceStatus: z.string().optional(), sourceActive: z.boolean().optional(),
  startsOn: z.string().nullable().optional(), endsOn: z.string().nullable().optional(), consentStatus: z.string().optional(),
  kind: z.enum(['test', 'initial']).optional(), locale: z.enum(['id', 'en']).optional(), firstSeenAt: z.string().optional(),
  lastPath: z.string().nullable().optional(), linked: z.boolean().optional(), totalRows: count.optional(), validRows: count.optional(),
  invalidRows: count.optional(), duplicateRows: count.optional(), suppressedRows: count.optional(), promotedRows: count.optional(),
}).strict();
// A malformed/unavailable reader is not an empty archive.
const Result = z.object({ version: z.literal(1), kind: z.string(), campaignId: z.string().uuid().nullable(), journeyId: z.string().uuid().nullable(),
  page: count, pageSize: z.literal(20), snapshotAt: z.string(), total: count, all: count,
  statusCounts: z.record(z.string(), count), records: z.array(Record).max(20),
}).strict();
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
} });
const failure = (code?: string) => json({ success: false, error: ['PGRST202', '42883', '42P01'].includes(code || '')
  ? 'Arsip kampanye memerlukan SQL88. Hubungi pengelola untuk menyelesaikan pembaruan.'
  : 'Arsip kampanye belum dapat dimuat. Periksa koneksi, lalu coba lagi.' }, 503);

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    if ('error' in admin) return json({ success: false, error: 'Sesi admin tidak tersedia.' }, admin.status);
    const limited = await enforceRateLimit(req, 'admin-campaign-archive', 300, 3600);
    if (limited) { limited.headers.set('Cache-Control', 'private, no-store'); return limited; }
    const params = req.nextUrl.searchParams;
    if (new Set(params.keys()).size !== params.size) return json({ success: false, error: 'Filter arsip kampanye tidak valid.' }, 400);
    const input = Query.parse(Object.fromEntries(params));
    const { data, error } = await createServerSupabase().rpc('admin_campaign_archive', {
      p_kind: input.kind, p_campaign_id: input.campaignId || null, p_journey_id: input.journeyId || null,
      p_page: input.page, p_search: input.search, p_status: input.status, p_channel: input.channel,
    });
    if (error) return failure(error.code);
    if (!data) return json({ success: false, error: 'Kampanye atau kunjungan tidak ditemukan. Perbarui daftar.' }, 404);
    const result = Result.safeParse(data);
    if (!result.success) return failure();
    const value = result.data;
    if (value.kind !== input.kind || value.page !== input.page || value.campaignId !== (input.campaignId || null)
      || value.journeyId !== (input.journeyId || null) || value.total > value.all
      || Object.values(value.statusCounts).reduce((sum, n) => sum + n, 0) !== value.all) return failure();
    return json({ success: true, ...value });
  } catch (error) {
    return error instanceof z.ZodError ? json({ success: false, error: 'Periksa kembali filter arsip kampanye.' }, 400) : failure();
  }
}
