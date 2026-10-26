import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { spinBody, spinFailure, spinJson, spinRPC } from '@/lib/spin/http';
import { MeetingCreateSchema, meetingDTO } from '@/lib/spin/meeting';

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return spinJson({ success: false, error: 'Akses admin diperlukan.' }, actor.status);
    const limited = await enforceRateLimit(req, 'spin-meeting-list', 300, 3600); if (limited) return limited;
    const page = z.coerce.number().int().min(0).max(10000).parse(req.nextUrl.searchParams.get('page') || 0);
    const search = z.string().trim().max(150).parse(req.nextUrl.searchParams.get('search') || '');
    return spinJson({ success: true, ...await spinRPC('spin_meeting_inbox', { p_page: page, p_search: search }) as object });
  } catch (error) { return spinFailure(error); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return spinJson({ success: false, error: 'Akses admin diperlukan.' }, actor.status);
    const limited = await enforceRateLimit(req, 'spin-meeting-create', 30, 3600); if (limited) return limited;
    const value = MeetingCreateSchema.parse(await spinBody(req));
    const saved = await spinRPC('spin_save_meeting', {
      p_id: value.id, p_actor: actor.userId, p_revision: 0, p_source_id: null,
      p_contact: value.contact, p_answers: {}, p_notes: '', p_status: 'in_progress',
    });
    return spinJson({ success: true, checklist: meetingDTO(saved) }, 201);
  } catch (error) { return spinFailure(error); }
}
