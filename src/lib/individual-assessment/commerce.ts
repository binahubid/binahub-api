import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPEInstrument } from './definition';

const text = (max: number) => z.string().trim().min(1).max(max).nullable();
const number = (max: number) => z.number().int().min(1).max(max).nullable();
export const PECommerceConfiguration = z.object({
  name: text(160), description: text(1200), priceIdr: number(1_000_000_000),
  attempts: number(20), startWithinDays: number(3650), completeWithinDays: number(3650),
  retentionMonths: number(120), refundPolicy: text(4000), terms: text(4000), reportVersion: text(100),
}).strict();
export const PECommerceSave = z.object({ revision: z.number().int().nonnegative(), configuration: PECommerceConfiguration }).strict();
export const PECommerceStatus = z.enum(['all','awaiting_payment','paid','cancelled','refund_pending','partially_refunded','refunded','disputed']);
const Dashboard = z.object({
  revision: z.number().int().nonnegative(), offerId: z.uuid(), configuration: PECommerceConfiguration,
  areaCodes: z.array(z.string()).length(3), instrumentVersion: z.string(), matchedCount: z.number().int().nonnegative(),
  counts: z.object({pending:z.number().int().nonnegative(),paid:z.number().int().nonnegative(),attention:z.number().int().nonnegative()}).strict(),
  orders: z.array(z.object({id:z.uuid(),email:z.email(),totalIdr:z.number().int().positive(),status:PECommerceStatus.exclude(['all']),
    createdAt:z.iso.datetime({offset:true}),accessStatus:z.enum(['available','in_progress','completed','expired','suspended','revoked']).nullable()}).strict()).max(50),
}).strict();

export async function peCommerceRPC(db: Pick<SupabaseClient,'rpc'>, name: string, args: Record<string,unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (['PGRST202','42883','42P01','PGRST205'].includes(error.code || '')) throw new Error('PE_COMMERCE_SETUP_REQUIRED');
    const code = /\bPE_[A-Z_]+\b/.exec(error.message || '')?.[0];
    throw new Error(code && ['PE_REVISION_CONFLICT','PE_INVALID_REQUEST','PE_COMMERCE_SETUP_REQUIRED'].includes(code) ? code : 'PE_SERVICE_UNAVAILABLE');
  }
  return data;
}

export async function loadPECommerceDashboard(db: SupabaseClient, query = '', status: z.infer<typeof PECommerceStatus> = 'all') {
  const result = Dashboard.safeParse(await peCommerceRPC(db,'pe_commerce_admin_dashboard',{p_query:query,p_status:status}));
  if (!result.success) throw new Error('PE_SERVICE_UNAVAILABLE');
  const dashboard = result.data;
  const instrument = await loadPEInstrument(db,dashboard.instrumentVersion);
  const areas = instrument.config.competencies.filter(area => dashboard.areaCodes.includes(area.code)).map(({code,name}) => ({code,name}));
  if (areas.length !== 3 || dashboard.areaCodes.some(code => ['PE-02','PE-04','PE-06'].includes(code))) throw new Error('PE_SERVICE_UNAVAILABLE');
  const labels: Record<keyof z.infer<typeof PECommerceConfiguration>,string> = {
    name:'Nama paket',description:'Deskripsi paket',priceIdr:'Harga total',attempts:'Kesempatan pengisian',
    startWithinDays:'Batas mulai',completeWithinDays:'Waktu penyelesaian',retentionMonths:'Masa simpan hasil',
    refundPolicy:'Ketentuan pengembalian dana',terms:'Ketentuan pembelian',reportVersion:'Format laporan',
  };
  const missing = Object.entries(dashboard.configuration).filter(([,value]) => value === null).map(([key]) => labels[key as keyof typeof labels]);
  return {...dashboard,areas,readiness:{canSell:false as const,missing:[...missing,'Integrasi dan pengujian payment gateway','Verifikasi email pelanggan dan pemulihan akses','Pengisian dan laporan area tambahan']}};
}
