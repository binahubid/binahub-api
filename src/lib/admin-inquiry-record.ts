export const inquiryDetailColumns = 'id,name,email,whatsapp,message,source,status,admin_notes,module_request_data,follow_up_level,follow_up_last_sent_at,follow_up_paused,reply_subject,reply_body,reply_status,reply_generated_at,reply_reviewed_at,reply_reviewed_by,reply_sent_at,reply_email_id,created_at';

export type AdminInquiryRow = {
  id: string; name: string | null; email: string | null; whatsapp?: string | null; message?: string | null;
  source?: string | null; status?: string | null; admin_notes?: string | null; module_request_data?: unknown;
  follow_up_level?: number | null; follow_up_last_sent_at?: string | null; follow_up_paused?: boolean | null;
  reply_subject?: string | null; reply_body?: string | null; reply_status?: string | null; reply_generated_at?: string | null;
  reply_reviewed_at?: string | null; reply_reviewed_by?: string | null; reply_sent_at?: string | null; reply_email_id?: string | null;
  created_at: string | null;
};
function moduleRequest(value: unknown) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
// Same detail contract as the existing dashboard; no stored row is rewritten.
export function mapAdminInquiry(item: AdminInquiryRow) {
  return {
    id: item.id, name: item.name || '-', email: item.email || '-', whatsapp: item.whatsapp || '', message: item.message || '',
    source: item.source || 'contact_form', status: item.status || 'Baru', notes: item.admin_notes || '',
    followUpLevel: item.follow_up_level || 0, followUpLastSentAt: item.follow_up_last_sent_at || null, followUpPaused: item.follow_up_paused === true,
    replySubject: item.reply_subject || '', replyBody: item.reply_body || '', replyStatus: item.reply_status || 'none',
    replyGeneratedAt: item.reply_generated_at || null, replyReviewedAt: item.reply_reviewed_at || null, replyReviewedBy: item.reply_reviewed_by || null,
    replySentAt: item.reply_sent_at || null, replyEmailId: item.reply_email_id || null, moduleRequest: moduleRequest(item.module_request_data), createdAt: item.created_at,
  };
}
