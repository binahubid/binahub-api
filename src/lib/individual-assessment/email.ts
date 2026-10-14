import 'server-only';
import { Resend } from 'resend';
import { createServerSupabase } from '@/lib/supabase';
import { resolvePublicAppUrl } from '@/lib/public-app-url';
import { pePilotRPC } from './pilot';
import { hashPEKey, peEmailLinkToken,queuePEReportHash,peGuestDeliveryConfigured } from './guest';
import { PEDeliveryError } from './delivery';
import { PEDeliveryAttemptSchema } from './delivery-contracts';
import { z } from 'zod';
import type { PEReportSnapshot } from './report';

const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export function renderPEEmail(name: string, report: PEReportSnapshot, url: string) {
  // The emailed link, not scores/raw answers, is the access boundary. No internal CC.
  return `<div style="background:#f7f8fa;padding:32px 16px;font-family:Arial,sans-serif;color:#0b2c6b"><div style="max-width:560px;margin:auto;background:white;border-radius:16px;padding:32px">
    <p style="font-size:20px;font-weight:bold">BinaHub</p><h1 style="font-size:24px;line-height:1.4">Hasil diagnosis Anda sudah tersedia.</h1>
    <p style="line-height:1.7">Halo ${escape(name)}, terima kasih telah meluangkan waktu untuk memahami kebutuhan pengembangan Anda.</p>
    <p style="line-height:1.7">Laporan Anda memuat profil tiga Area, penjelasan hasil, serta langkah latihan yang dapat Anda mulai.</p>
    <p style="margin:28px 0"><a href="${escape(url)}" style="display:inline-block;background:#0b2c6b;color:white;padding:15px 22px;text-decoration:none;border-radius:9px;font-weight:bold">Buka hasil diagnosis</a></p>
    <p style="font-size:13px;line-height:1.7;color:#475569">Tautan ini berlaku 48 jam dan hanya dapat digunakan sekali. Setelah dibuka, sesi akses tersedia selama 30 menit. Bila sudah kedaluwarsa, Anda dapat meminta tautan baru dari halaman hasil.</p>
    <p style="font-size:13px;line-height:1.7;color:#475569">Jangan meneruskan tautan ini karena berisi akses ke laporan pribadi Anda. Hasil digunakan untuk refleksi dan pengembangan, bukan diagnosis klinis atau dasar keputusan seleksi/promosi.</p>
    <p style="font-size:12px;color:#64748b">Tanggal diagnosis: ${escape(new Date(report.metadata.assessmentDate!).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' }))}. Butuh bantuan? <a href="mailto:admin@binahub.id">admin@binahub.id</a>.</p>
    </div></div>`;
}

export async function processPEReportEmail(attemptId?: string) {
  if(!peGuestDeliveryConfigured())throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
  const db = createServerSupabase();
  if(!attemptId){
    // Repair a crash between immutable scoring and queue insertion, including a closed browser.
    try{
      const pending=await pePilotRPC(db,'pe_next_unqueued_report');
      if(pending){const input=z.object({attempt:PEDeliveryAttemptSchema,draftHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(pending);
        await queuePEReportHash(db,input.attempt.id,input.draftHash,input.attempt);}
    }catch{console.error('[PE email] PE_REPORT_RECOVERY_RETRY');}
    try{await pePilotRPC(db,'pe_cleanup_result_sessions');}catch{console.error('[PE retention] PE_SESSION_CLEANUP_RETRY');}
  }
  const claim = await pePilotRPC(db, 'pe_claim_report_email', { p_id: attemptId || null,p_from:process.env.EMAIL_FROM,p_origin:resolvePublicAppUrl() }) as {
    id: string; attemptId: string; leaseToken: string; email: string; name: string;from:string;origin:string; linkHash: string; snapshot: PEReportSnapshot;
  } | null;
  if (!claim) return { processed: false };
  let providerId: string | null = null;
  try {
    const token = peEmailLinkToken(claim.id);
    if (hashPEKey(token) !== claim.linkHash) throw new Error('PE_LINK_CONFIGURATION_CHANGED');
    const url = `${claim.origin}/insight/individual/result?attempt=${encodeURIComponent(claim.attemptId)}#access=${token}`;
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: claim.from, to: claim.email, subject: 'Hasil diagnosis pengembangan Anda — BinaHub',
      html: renderPEEmail(claim.name, claim.snapshot, url),
      text: `Halo ${claim.name}, hasil diagnosis Anda tersedia. Buka melalui tautan pribadi berikut (berlaku 48 jam, sekali pakai): ${url}\nJangan teruskan tautan ini. Bantuan: admin@binahub.id.`,
      tags: [{ name: 'category', value: 'individual_assessment_result' }],
    }, { idempotencyKey: `pe-result-${claim.id}` });
    if (result.error || !result.data?.id) throw new Error('PE_EMAIL_PROVIDER_UNAVAILABLE');
    providerId = result.data.id;
    if(await pePilotRPC(db, 'pe_finish_report_email', { p_id: claim.id, p_lease: claim.leaseToken, p_provider: providerId, p_error: null })!==true)throw new Error('PE_EMAIL_STATE_CONFLICT');
    return { processed: true, status: 'sent' };
  } catch {
    // Log only a stable code. Provider diagnostics may contain recipient addresses or links.
    console.error('[PE email] PE_EMAIL_DELIVERY_RETRY');
    if (!providerId) await pePilotRPC(db, 'pe_finish_report_email', {
      p_id: claim.id, p_lease: claim.leaseToken, p_provider: null, p_error: 'PE_EMAIL_DELIVERY_RETRY',
    });
    // When provider accepted but persistence failed, the leased job is reclaimed with the same
    // body/link/idempotency key, only within the provider deduplication window.
    return { processed: true, status: 'pending' };
  }
}
