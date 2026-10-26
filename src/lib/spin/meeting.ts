import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase';
import { SpinAnswerSchema, SpinContactSchema, SpinError, SPIN_DEFINITION, validateSpinAnswers } from './intake';
import { type SpinAnswers } from './form';

export const MeetingWriteSchema = z.object({
  revision: z.number().int().nonnegative(), answers: SpinAnswerSchema,
  notes: z.string().trim().max(4000), status: z.enum(['in_progress', 'completed']),
}).strict();
export const MeetingCreateSchema = z.object({
  id: z.uuid(), contact: SpinContactSchema, processingNoticeConfirmed: z.literal(true),
}).strict();
const checklistDTO = z.object({
  id: z.uuid(), source_id: z.uuid().nullable(), contact: SpinContactSchema,
  answers: SpinAnswerSchema, notes: z.string().max(4000),
  status: z.enum(['in_progress', 'completed']), revision: z.number().int().nonnegative(),
  updated_at: z.string().nullable(),
});
export function meetingDTO(value: unknown) {
  const result = checklistDTO.safeParse(value);
  if (!result.success) throw new SpinError('SPIN_STORAGE_UNAVAILABLE');
  return result.data;
}
export function validateMeetingWrite(raw: unknown, original: SpinAnswers) {
  const value = MeetingWriteSchema.parse(raw);
  const effective = validateSpinAnswers({ ...original, ...value.answers }, value.status === 'completed');
  // Keep only explicit admin additions/clarifications that remain in the active branch.
  const answers: SpinAnswers = {};
  for (const key of Object.keys(value.answers)) {
    if (effective[key] !== undefined && JSON.stringify(effective[key]) !== JSON.stringify(original[key])) answers[key] = effective[key];
  }
  return { ...value, answers };
}
export async function readMeeting(id: string) {
  const db = createServerSupabase();
  const [saved, source] = await Promise.all([
    db.from('spin_meeting_checklists').select('id,source_id,contact,answers,notes,status,revision,updated_at').eq('id', id).maybeSingle(),
    db.from('spin_submissions').select('id,answers,contact,question_version').eq('id', id).not('submitted_at', 'is', null).maybeSingle(),
  ]);
  if (saved.error) throw new SpinError('SPIN_MEETING_SETUP_REQUIRED');
  if (source.error) throw new SpinError('SPIN_STORAGE_UNAVAILABLE');
  if (!saved.data && !source.data) throw new SpinError('SPIN_NOT_FOUND');
  if (source.data && source.data.question_version !== SPIN_DEFINITION.version) throw new SpinError('SPIN_MEETING_VERSION_CONFLICT');
  if (saved.data && saved.data.source_id !== (source.data?.id ?? null)) throw new SpinError('SPIN_STORAGE_UNAVAILABLE');
  const original = source.data ? validateSpinAnswers(SpinAnswerSchema.parse(source.data.answers)) : {};
  const checklist = meetingDTO(saved.data ?? {
    id, source_id: source.data!.id, contact: source.data!.contact,
    answers: {}, notes: '', status: 'in_progress', revision: 0, updated_at: null,
  });
  return { checklist, original, definition: SPIN_DEFINITION };
}
