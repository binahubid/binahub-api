import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callAms } from '@/lib/ams-client';
import { createServerSupabase } from '@/lib/supabase';

export const consultantNotificationContext = z.object({
  eventId: z.uuid(), sourceId: z.uuid(), kind: z.enum(['assignment','schedule','task']),
  version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), associateId: z.uuid(),
}).strict();
export async function consultantNotificationCurrent(input: z.infer<typeof consultantNotificationContext>) {
  const { data, error } = await createServerSupabase().rpc('consultant_notice_payload', { p_id: input.eventId });
  if (error) throw new Error('CONSULTANT_NOTICE_UNAVAILABLE');
  return Boolean(data && data.active === true && data.associateId === input.associateId
    && data.sourceId === input.sourceId && data.kind === input.kind && data.version === input.version);
}
export async function processConsultantNotifications() {
  const db = createServerSupabase(), lease = randomUUID();
  const { data, error } = await db.rpc('consultant_notice_claim', { p_lease: lease, p_limit: 5 });
  if (error) {
    if (['42883','42P01','PGRST202'].includes(error.code || '')) return { state: 'setup_required', accepted: 0 };
    throw new Error('CONSULTANT_NOTICE_UNAVAILABLE');
  }
  const rows = (data || []) as Array<{ id: string }>;
  let accepted = 0, deferred = 0, skipped = 0;
  for (let index = 0; index < rows.length; index += 2) {
    await Promise.all(rows.slice(index, index + 2).map(async row => {
      let status = 'accepted', code: string | null = null;
      try {
        const { data: payload, error } = await db.rpc('consultant_notice_payload', { p_id: row.id });
        if (error) throw new Error('CONTEXT_UNAVAILABLE');
        if (!payload) { status = 'skipped'; skipped++; }
        else {
          await callAms('/api/integrations/app/notifications', payload, 5000);
          accepted++;
        }
      } catch { status = 'pending'; code = 'AMS_NOT_AVAILABLE'; deferred++; }
      const { data: done, error } = await db.rpc('consultant_notice_finish', { p_id: row.id, p_lease: lease, p_status: status, p_error: code });
      if (error || !done) throw new Error('CONSULTANT_NOTICE_LEASE_LOST');
    }));
  }
  return { state: deferred ? 'degraded' : 'ok', accepted, deferred, skipped };
}
