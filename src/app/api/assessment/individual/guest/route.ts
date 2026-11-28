import { NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getCorsHeaders } from '@/lib/cors';
import { referralAttribution, referralRpc } from '@/lib/referrals';
import { peFailure, peJson, readPEBody } from '@/lib/individual-assessment/http';
import { getPEDeliveryDefinition, PEDeliveryError } from '@/lib/individual-assessment/delivery';
import { pePilotRPC } from '@/lib/individual-assessment/pilot';
import { hashPEKey, peGuestDeliveryConfigured, peGuestDTO, PEGuestEnvelopeSchema, PEGuestStartSchema } from '@/lib/individual-assessment/guest';

export const maxDuration = 120;
export async function GET(req: NextRequest) {
  try {
    const limited = await enforceRateLimit(req, 'pe-guest-definition', 120, 3600); if (limited) return limited;
    const db = createServerSupabase();
    const setup = await db.from('pe_guest_contacts').select('attempt_id,whatsapp').limit(0);
    const whatsappAvailable = !setup.error;
    if (setup.error?.code === '42703') {
      const existing = await db.from('pe_guest_contacts').select('attempt_id').limit(0);
      if (existing.error) throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
    } else if (setup.error) throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
    if (!peGuestDeliveryConfigured()) throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
    const { definition } = await getPEDeliveryDefinition(db);
    const ready = await pePilotRPC(db, 'pe_pilot_ready');
    return peJson({ success: true, definition: { ...definition, acceptingNew: ready === true, whatsappAvailable,
      features: { pilot: true, history: false }, sharingConsentVersion: 'pe-consultant-review-v1',
      sharingNotice: 'Atas persetujuan Anda, tim BinaHub dapat meninjau nama, informasi pekerjaan, jawaban, dan hasil Self Diagnostic untuk memberikan rekomendasi pengembangan. Informasi ini tidak dibagikan secara otomatis kepada perusahaan Anda.',
      privacyNotice: definition.freeResultHours===48
       ?'Nama dan alamat email digunakan untuk mengirim tautan hasil pribadi Anda. Nomor WhatsApp bersifat opsional dan digunakan untuk tindak lanjut layanan. Hasil gratis dapat diakses selama 48 jam sejak jawaban dikirim. Tautan dapat dibuka kembali selama 30 menit sejak akses pertama; setelah itu, mintalah tautan baru sebelum masa akses hasil berakhir. Setelah 48 jam, hasil tidak dapat diakses atau diminta kembali dan data masuk proses penghapusan otomatis. Bantuan terkait data: admin@binahub.id.'
       :'Nama dan alamat email digunakan untuk mengirim tautan hasil pribadi Anda. Nomor WhatsApp bersifat opsional dan digunakan untuk tindak lanjut layanan. Jawaban disimpan selama enam bulan. Melalui halaman hasil, Anda dapat mencabut izin akses tim BinaHub atau menghapus data pengisian lebih awal. Untuk bantuan terkait data pribadi, hubungi admin@binahub.id.',
    } });
  } catch (error) { return peFailure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin');
    if (origin && !getCorsHeaders(origin)['Access-Control-Allow-Origin']) return peJson({ success: false, error: 'Permintaan tidak diizinkan.' }, 403);
    const limited = await enforceRateLimit(req, 'pe-guest-start', 10, 3600); if (limited) return limited;
    if (!peGuestDeliveryConfigured()) throw new PEDeliveryError('PE_GUEST_SETUP_REQUIRED');
    const input = PEGuestStartSchema.parse(await readPEBody(req)), db = createServerSupabase();
    const referral = await referralAttribution(req, input.referralConsentCode);
    await getPEDeliveryDefinition(db);
    const start = input.whatsapp ? 'pe_start_guest_with_whatsapp' : 'pe_start_guest';
    const envelope = PEGuestEnvelopeSchema.parse(await pePilotRPC(db, start, {
      p_id: input.id, p_hash: hashPEKey(input.draftKey), p_name: input.name, p_email: input.email, p_context: input.context,
      p_consent_version: input.consentVersion, p_privacy_version: input.privacyVersion,
      p_sharing_version: input.sharingConsentVersion || null, p_channel: input.channel,
      ...(input.whatsapp ? { p_whatsapp: input.whatsapp } : {}),
    }));
    await pePilotRPC(db,'pe_record_acquisition_context',{p_id:input.id,p_hash:hashPEKey(input.draftKey),
      p_context:{...input.attribution,...(input.journeyId?{journeyId:input.journeyId}:{})}});
    if (referral.visitId) {
      await referralRpc('referral_prepare_individual', {
        p_id: input.id, p_hash: hashPEKey(input.draftKey), p_visit: referral.visitId, p_share: referral.share,
      });
    }
    // No email before the participant submits.
    return peJson({ success: true, ...peGuestDTO(envelope) }, 201);
  } catch (error) { return peFailure(error); }
}
