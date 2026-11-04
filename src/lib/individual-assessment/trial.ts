import 'server-only';
import { z } from 'zod';
import { hashPEInstrument, getPEParticipantDefinition } from './definition';
import { scorePEResponses } from './scoring';
import type { PEInstrument } from './instrument-contract';
import { hashRMInstrument, rmParticipantDefinition, type RMInstrument } from '../relationship-management/instrument';
import { previewRMReport } from '../relationship-management/scoring';

// A demonstration, NOT a commerce entitlement, payment status or participant record.
export const TrialProductSchema = z.enum(['pe', 'rm']);
export type TrialProduct = z.infer<typeof TrialProductSchema>;
export const TrialSubmissionSchema = z.object({
  product: TrialProductSchema, revision: z.string().regex(/^[a-f0-9]{64}$/),
  responses: z.record(z.string().max(40), z.union([z.number().int().min(1).max(5), z.enum(['NA', 'A', 'B', 'C', 'D'])])),
}).strict();
export const TRIAL_OFFERS = {
  pe: { title: 'Personal Effectiveness', price: 59000, selfReport: 24, sjt: 12 },
  rm: { title: 'Relationship Management', price: 89000, selfReport: 27, sjt: 13 },
} as const;
const round = (n: number) => Math.round(n * 100) / 100;
const combine = (a: number | null, b: number | null) => a === null || b === null ? null : round((a + b) / 2);
const mean = (values: (number | null)[]) => values.some(v => v === null) ? null : round((values as number[]).reduce((a, b) => a + b, 0) / values.length);
export type TrialSource = { product: 'pe'; instrument: PEInstrument } | { product: 'rm'; instrument: RMInstrument };
export function trialDefinition(source: TrialSource) {
  const definition = source.product === 'pe' ? getPEParticipantDefinition(source.instrument) : rmParticipantDefinition(source.instrument);
  return { product: source.product, offer: TRIAL_OFFERS[source.product], demo: true as const,
    revision: source.product === 'pe' ? hashPEInstrument(source.instrument) : hashRMInstrument(source.instrument),
    // Deliberate allowlist: never forward an instrument or internal scoring metadata.
    definition: { title: TRIAL_OFFERS[source.product].title,
      selfReportScale: definition.selfReportScale.map(o => ({ value: o.value, label: o.label })),
      selfReportItems: definition.selfReportItems.map(i => ({ id: i.id, prompt: i.prompt })),
      sjtItems: definition.sjtItems.map(i => ({ id: i.id, scenario: i.scenario,
        question: 'Apa tindakan yang Anda pilih?', options: i.options.map(o => ({ id: o.id, text: o.text })) })),
    } };
}
export function trialReport(source: TrialSource, input: unknown) {
  const submission = TrialSubmissionSchema.parse(input);
  if (submission.product !== source.product || submission.revision !== trialDefinition(source).revision) throw new Error('TRIAL_SOURCE_CHANGED');
  let moduleProfile: { selfReport: number | null; sjt: number | null; combined: number | null };
  let areas: { code: string; name: string; selfReport: number | null; sjt: number | null; combined: number | null }[];
  if (source.product === 'pe') {
    const ids = [...source.instrument.config.self_report_items, ...source.instrument.config.sjt_items].map(i => i.id);
    if (ids.some(id => !Object.hasOwn(submission.responses, id))) throw new Error('TRIAL_ANSWERS_INCOMPLETE');
    const scored = scorePEResponses(submission.responses, source.instrument);
    areas = scored.competencies.map(c => ({ code: c.code,
      name: source.instrument.config.competencies.find(i => i.code === c.code)!.name,
      selfReport: c.selfReport.score, sjt: c.sjt.score, combined: combine(c.selfReport.score, c.sjt.score) }));
    const selfReport = mean(areas.map(a => a.selfReport)), sjt = mean(areas.map(a => a.sjt));
    moduleProfile = { selfReport, sjt, combined: combine(selfReport, sjt) };
  } else {
    const scored = previewRMReport(source.instrument, submission.responses, true);
    moduleProfile = { selfReport: scored.moduleProfile.selfReport, sjt: scored.moduleProfile.sjt, combined: scored.moduleProfile.combined };
    areas = scored.areas.map(c => ({ code: c.code, name: c.name, selfReport: c.selfReport.score, sjt: null, combined: null }));
  }
  return { demo: true as const, product: source.product, title: TRIAL_OFFERS[source.product].title,
    moduleProfile, areas, generatedAt: new Date().toISOString(),
    notice: 'Hasil uji coba dari jawaban Anda. Skor dihitung dengan aturan instrumen, bukan oleh AI. Bobot gabungan sementara 50:50; bukan kategori atau norma kemampuan.',
    methodNote: source.product === 'rm'
      ? 'Skor studi kasus RM tersedia untuk keseluruhan modul. Nilai studi kasus dan gabungan per kompetensi belum ditampilkan karena bobotnya belum ditetapkan CEO.'
      : 'Ringkasan modul merata-ratakan enam kompetensi per metode, lalu menggabungkan kedua metode 50:50. NA bukan nol; bila bukti pengalaman nyata belum cukup, skor terkait tidak ditampilkan.',
    nextSteps: ['Pilih satu kompetensi untuk dilatih dalam situasi nyata minggu ini.',
      'Catat tindakan dan perubahan yang dapat diamati, lalu mintalah umpan balik.',
      'Latih kemampuan ini mulai sekarang, tinjau kembali kompetensi Anda dalam waktu satu bulan ke depan.'],
  };
}
