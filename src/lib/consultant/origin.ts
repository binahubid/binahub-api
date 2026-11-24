import "server-only";
import { createServerSupabase } from "@/lib/supabase";
import type { ConsultantLead, ConsultantOrigin } from "./schemas";

const sources: Record<string, [ConsultantOrigin["kind"], string]> = {
  spin_discovery: ["recommendation", "Rekomendasi Program"],
  insight_assessment: ["assessment_team", "Diagnosis Tim / Organisasi"],
  individual_assessment: ["assessment_individual", "Diagnosis Individu"],
  contact_form: ["inquiry", "Inquiry / Permintaan Informasi"],
  "cal.com": ["consultation", "Booking Konsultasi"],
  manual_upload: ["outbound", "Kontak Penjualan"],
  ai_lead_discovery: ["outbound", "Kontak Penjualan"],
};

/** Decorate only records already authorized by consultant_portal_read/detail.
 * Source labels describe the recorded lead channel, not inferred private history.
 * No assessment answers, results, campaign metadata, or email matches are read.
 */
export async function withConsultantOrigins<T extends Pick<ConsultantLead, "id">>(records: T[]) {
  if (!records.length) return [];
  const fallback = (status: "unrecorded" | "unavailable"): ConsultantOrigin => ({
    kind: "unknown", status,
    label: status === "unavailable" ? "Sumber belum dapat dimuat" : "Sumber belum tercatat",
  });
  try {
    const ids = [...new Set(records.map((r) => r.id))];
    const { data, error } = await createServerSupabase().from("leads").select("id,source").in("id", ids)
      .abortSignal(AbortSignal.timeout(2000));
    if (error || !Array.isArray(data)) throw new Error("Source context unavailable");
    const origins = new Map(data.filter((r) => ids.includes(r.id)).map((r) => {
      const known = typeof r.source === "string" && Object.hasOwn(sources, r.source) ? sources[r.source] : undefined;
      return [r.id, known ? { kind: known[0], label: known[1], status: "recorded" } as ConsultantOrigin : fallback("unrecorded")];
    }));
    return records.map((record) => ({ ...record, origin: origins.get(record.id) || fallback("unrecorded") }));
  } catch {
    return records.map((record) => ({ ...record, origin: fallback("unavailable") }));
  }
}
