import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { mapAdminAssessment, type AdminAssessmentRow, type AdminAssessmentLead } from '@/lib/admin-assessment-record';

const text = z.string().trim().max(150).regex(/^[^\u0000-\u001f\u007f]*$/);
const Query = z.object({
  page: z.coerce.number().int().min(0).max(10000).default(0), search: text.default(''),
  category: text.default(''), employees: text.default(''), minScore: z.coerce.number().int().min(0).max(100).default(0),
  queue: z.enum(['all', 'attention', 'processing', 'sent']).default('all'), sort: z.enum(['latest', 'attention']).default('latest'),
}).strict();
const detailColumns = 'id,lead_id,form_data,scores,category,ai_analysis,recommendations,overall_score,assessment_status,result_email_sent_at,result_email_id,proposal_status,proposal_sent_at,proposal_email_id,proposal_requested_at,result_follow_up_level,result_follow_up_sent_at,proposal_follow_up_level,proposal_follow_up_sent_at,follow_up_paused,proposal_draft_data,proposal_gate_status,proposal_gate_reasons,proposal_catalog_version,proposal_generated_at,proposal_approved_at,proposal_approved_by,created_at';
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: {
  'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
} });
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return json({ success: false, error: 'Sesi admin tidak tersedia.' }, actor.status);
    const limited = await enforceRateLimit(req, 'admin-assessment-inbox', 300, 3600); if (limited) return limited;
    const params = req.nextUrl.searchParams;
    const db = createServerSupabase();
    if (params.has('distribution')) {
      if (params.size !== 1 || params.get('distribution') !== '1') return json({ success: false, error: 'Permintaan pola jawaban tidak valid.' }, 400);
      const { data, error } = await db.rpc('admin_assessment_answer_distribution');
      if (error || !Array.isArray(data) || data.length !== 49) return json({ success: false, error: 'Pola jawaban belum dapat dimuat. Pastikan SQL82 sudah diterapkan.' }, 503);
      return json({ success: true, answerDistribution: data });
    }
    if (params.has('id')) {
      if (params.size !== 1) return json({ success: false, error: 'Permintaan detail tidak valid.' }, 400);
      const id = z.uuid().parse(params.get('id'));
      const record = await db.from('assessments').select(detailColumns).eq('id', id).maybeSingle();
      if (record.error) return json({ success: false, error: 'Detail diagnosis belum dapat dimuat.' }, 503);
      if (!record.data) return json({ success: false, error: 'Diagnosis tidak ditemukan.' }, 404);
      const row = record.data as AdminAssessmentRow;
      let lead: AdminAssessmentLead | undefined;
      if (row.lead_id) {
        const linked = await db.from('leads').select('name,email,company,phone,industry,location,source,source_metadata,lead_score_rule_version,lifecycle_stage,opportunity_stage').eq('id', row.lead_id).maybeSingle();
        if (linked.error) return json({ success: false, error: 'Konteks klien belum dapat dimuat.' }, 503);
        lead = linked.data || undefined;
      }
      return json({ success: true, record: mapAdminAssessment(row, lead) });
    }
    const query = Query.parse(Object.fromEntries(params));
    const { data, error } = await db.rpc('admin_assessment_inbox', {
      p_page: query.page, p_search: query.search, p_category: query.category, p_employees: query.employees,
      p_min_score: query.minScore, p_queue: query.queue, p_sort: query.sort,
    });
    if (error) return json({ success: false, error: error.code === 'PGRST202' || error.code === '42883'
      ? 'Daftar diagnosis memerlukan SQL82. Hubungi pengelola untuk menyelesaikan pembaruan.'
      : 'Daftar diagnosis belum dapat dimuat. Silakan coba lagi.' }, 503);
    if (!data || data.version !== 1 || !Array.isArray(data.records) || !Number.isSafeInteger(data.total) || data.total < 0) return json({ success: false, error: 'Respons daftar diagnosis belum tersedia.' }, 503);
    return json({ success: true, ...data });
  } catch (error) {
    return json({ success: false, error: error instanceof z.ZodError ? 'Periksa kembali filter pencarian.' : 'Diagnosis belum dapat dimuat. Silakan coba lagi.' }, error instanceof z.ZodError ? 400 : 503);
  }
}
