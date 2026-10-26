import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin-auth';
import { enforceRateLimit } from '@/lib/rate-limit';
import { spinBody, spinFailure, spinJson, spinRPC } from '@/lib/spin/http';
import { meetingDTO, readMeeting, validateMeetingWrite } from '@/lib/spin/meeting';
type Context = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return spinJson({ success: false, error: 'Akses admin diperlukan.' }, actor.status);
    const limited = await enforceRateLimit(req, 'spin-meeting-read', 300, 3600); if (limited) return limited;
    const id = z.uuid().parse((await ctx.params).id);
    return spinJson({ success: true, ...await readMeeting(id) });
  } catch (error) { return spinFailure(error); }
}
export async function PATCH(req: NextRequest, ctx: Context) {
  try {
    const actor = await requireAdmin(req);
    if ('error' in actor) return spinJson({ success: false, error: 'Akses admin diperlukan.' }, actor.status);
    const limited = await enforceRateLimit(req, 'spin-meeting-write', 180, 3600); if (limited) return limited;
    const id = z.uuid().parse((await ctx.params).id);
    const body = await spinBody(req), current = await readMeeting(id);
    const value = validateMeetingWrite(body, current.original);
    const saved = await spinRPC('spin_save_meeting', {
      p_id: id, p_actor: actor.userId, p_revision: value.revision, p_source_id: current.checklist.source_id,
      p_contact: current.checklist.contact, p_answers: value.answers, p_notes: value.notes, p_status: value.status,
    });
    return spinJson({ success: true, checklist: meetingDTO(saved) });
  } catch (error) { return spinFailure(error); }
}
