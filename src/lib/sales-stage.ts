import type { createServerSupabase } from './supabase';

/** Only the database may advance activity-derived stages. Never regress a won/lost/customer record. */
export async function advanceSalesStage(db: ReturnType<typeof createServerSupabase>, leadId: string,
  stage: 'identified' | 'qualified' | 'consultation' | 'proposal') {
  const { data, error } = await db.rpc('advance_sales_stage_from_activity', { p_lead_id: leadId, p_stage: stage });
  if (error) throw new Error('SALES_STAGE_UPDATE_UNAVAILABLE');
  return data as { stage: string; advanced: boolean };
}
