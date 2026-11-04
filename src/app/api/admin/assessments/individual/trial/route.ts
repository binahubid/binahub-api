import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { createServerSupabase } from '@/lib/supabase';
import { enforceRateLimit } from '@/lib/rate-limit';
import { peJson, readPEBody } from '@/lib/individual-assessment/http';
import { loadPEInstrument } from '@/lib/individual-assessment/definition';
import { loadRMInstrument } from '@/lib/relationship-management/instrument';
import { TrialProductSchema, TrialSubmissionSchema, trialDefinition, trialReport, type TrialProduct, type TrialSource } from '@/lib/individual-assessment/trial';

export const runtime = 'nodejs';
async function guard(req: NextRequest) {
  const actor = await requireAdmin(req);
  if ('error' in actor) return peJson({ success: false, error: 'Akses admin diperlukan.' }, actor.status);
  const limited = await enforceRateLimit(req, `individual-trial-${actor.userId}`, 120, 3600);
  return limited || { db: createServerSupabase() };
}
async function source(db: ReturnType<typeof createServerSupabase>, product: TrialProduct): Promise<TrialSource> {
  if (product === 'pe') return { product, instrument: await loadPEInstrument(db) };
  const instrument = await loadRMInstrument(db);
  if (!instrument) throw new Error('TRIAL_SOURCE_UNAVAILABLE');
  return { product, instrument };
}
export async function GET(req: NextRequest) {
  const actor = await guard(req); if (actor instanceof Response) return actor;
  const parsed = TrialProductSchema.safeParse(req.nextUrl.searchParams.get('product'));
  if (!parsed.success) return peJson({ success: false, error: 'Pilih paket PE atau RM.' }, 400);
  try { return peJson({ success: true, ...trialDefinition(await source(actor.db, parsed.data)) }); }
  catch { return peJson({ success: false, error: 'Sumber soal belum tersedia atau integritasnya belum lolos. Periksa instalasi instrumen sebelum melanjutkan.' }, 503); }
}
export async function POST(req: NextRequest) {
  const actor = await guard(req); if (actor instanceof Response) return actor;
  let body: unknown;
  try { body = await readPEBody(req); } catch { return peJson({ success: false, error: 'Permintaan tidak valid atau terlalu besar.' }, 400); }
  const parsed = TrialSubmissionSchema.safeParse(body);
  if (!parsed.success) return peJson({ success: false, error: 'Periksa format jawaban Anda.' }, 400);
  let instrument: TrialSource;
  try { instrument = await source(actor.db, parsed.data.product); }
  catch { return peJson({ success: false, error: 'Sumber soal belum dapat dimuat. Jawaban tetap tersedia di tab ini; coba lagi.' }, 503); }
  try { return peJson({ success: true, report: trialReport(instrument, parsed.data) }); }
  catch (error) {
    if (error instanceof Error && error.message === 'TRIAL_SOURCE_CHANGED') return peJson({ success: false, code: 'TRIAL_SOURCE_CHANGED', error: 'Versi soal berubah. Mulai ulang uji coba untuk memakai versi terbaru.' }, 409);
    return peJson({ success: false, error: 'Lengkapi semua pertanyaan dan periksa pilihan jawaban sebelum mengirim.' }, 422);
  }
}
// No checkout/webhook, payment ledger, entitlement, worker enqueue, email, or database write.
