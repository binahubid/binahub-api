import 'server-only';
import { createHash } from 'node:crypto';
import type { PEInstrument } from './instrument-contract';
import type { PEDeliveryAttempt } from './delivery-contracts';
import { buildPEDevelopmentReport,loadPEPersonalSolutions } from './delivery';

export const PE_REPORT_VERSION = 'pe-development-report-v2';
export function buildPEReport(attempt: PEDeliveryAttempt, instrument: PEInstrument,solutions?:Awaited<ReturnType<typeof loadPEPersonalSolutions>>,wording:Record<string,string>={}) {
  const base = structuredClone(buildPEDevelopmentReport(attempt, instrument,wording));
  const result = attempt.result!;
  const date = new Date(attempt.submittedAt!);
  const followUpDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta'}).format(new Date(date.getTime() + 30 * 86_400_000));
  const areas = base.areas.map(area => {
    const sr = area.selfReport, sjt = area.sjt;
    const interpretation = sr.status !== 'scored' || sjt.status !== 'scored'
      ? 'Bukti belum lengkap pada kedua metode. Area ini belum dapat digunakan untuk menarik kesimpulan pengembangan.'
      : area.practice?.focus || 'Pilih satu situasi nyata untuk berlatih dan mintalah umpan balik dari orang yang terlibat.';
    const practice = area.practice && sr.status==='scored' && sjt.status==='scored' ? {
      ...area.practice,
      context: `Dalam peran Anda sebagai ${attempt.context.role}, pilih satu tugas yang berkaitan dengan tujuan “${attempt.context.goal}”. Tentukan kapan perilaku ini dapat dipraktikkan dan siapa yang dapat memberi umpan balik.`,
      successIndicator: `Catat situasi, tindakan “${area.practice.focus}”, dan hasil yang dapat diamati pada sedikitnya satu kesempatan. Bandingkan dengan tujuan Anda dan mintalah umpan balik dari orang yang terlibat.`,
      followUp: `Tinjau pengalaman latihan pada ${new Date(followUpDate + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })}. Tanggal ini adalah saran latihan, bukan jadwal pertemuan otomatis.`,
      followUpDate,
    } : null;
    const combinedScore=sr.score===null||sjt.score===null?null:Math.round((sr.score*.5+sjt.score*.5)*100)/100;
    return { ...area, combinedScore,interpretation, practice };
  });
  const priorities = base.priorities.map(priority => ({ ...priority,
    practice: areas.find(area => area.code === priority.code)?.practice || null }));
  const envelope = {
    ...base, version: PE_REPORT_VERSION, areas, priorities,
    ...(solutions?{solutions}:{}),
    metadata: {
      instrumentId: result.instrumentId, instrumentVersion: result.instrumentVersion,
      scoringVersion: result.scoringVersion, reportVersion: PE_REPORT_VERSION,
      priorityVersion: result.priorityVersion, assessmentDate: attempt.submittedAt,
      displayScoringVersion:'pe-display-equal-methods-v1',participantCopyVersion:'pe-owner-copy-2026-10-28-v1',
      publicWordingVersion:'pe-public-behavior-v1',
      freeResultHours:new Date(attempt.retentionUntil).getTime()>date.getTime()&&new Date(attempt.retentionUntil).getTime()-date.getTime()<=48*3600000?48:null,
      generatedAt: new Date().toISOString(), releaseStatus: result.releaseStatus,
    },
    summary: {
      role: attempt.context.role, goal: attempt.context.goal,
      expectedCount: result.completeness.expectedCount, answeredCount: result.completeness.answeredCount,
      naCount: result.completeness.naCount,
      areasWithBothMethods: areas.filter(area => area.selfReport.status === 'scored' && area.sjt.status === 'scored').length,
      focusNames: priorities.map(priority => priority.name),
      description: 'Profil ini merangkum pengalaman kerja dan respons studi kasus Anda. Fokus latihan adalah kandidat pengembangan berdasarkan relevansi dan kecukupan bukti, bukan label kemampuan atau diagnosis.',
    },
    methodology: base.methodology + ' Pengalaman kerja memakai skala frekuensi 1–5 untuk tiga bulan terakhir; NA dikeluarkan dari perhitungan. Skor tampil bila sedikitnya tiga dari empat respons valid. Studi kasus memakai aturan kredit CEO dan memerlukan dua skenario terjawab per Area.',
    privacy: {
      purpose: 'Refleksi dan rekomendasi pengembangan pribadi oleh tim BinaHub dengan izin Anda.',
      access: 'Hasil tidak dibagikan otomatis ke perusahaan. Anda dapat mencabut akses tim BinaHub dan meminta penghapusan.',
      retentionUntil: attempt.retentionUntil,
      contact: 'admin@binahub.id',
      process: 'Untuk koreksi identitas, bantuan akses, atau permintaan terkait data, hubungi tim BinaHub melalui email ini. Jangan sertakan jawaban lengkap atau tautan akses pribadi dalam pesan awal.',
    },
  };
  return { ...envelope, integrity: createHash('sha256').update(JSON.stringify(envelope)).digest('hex') };
}

export type PEReportSnapshot = ReturnType<typeof buildPEReport>;
