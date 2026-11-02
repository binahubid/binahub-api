import React from 'react';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { EnterpriseAssessmentReport } from './assessment-report-enterprise';
import { SignatureProposalReport } from './signature-proposal-report';
import { SpinPDF } from './spin/pdf';
import type { SpinReport } from './spin/report';
import { ProgramQuestionnaireReportDocument } from './program-questionnaire-report-document';
import { TbosTeamReportDocument, TbosGroupReportDocument } from './tbos-report-document';
import { buildTbosProgramReport, TBOS_REPORT_DIMENSIONS } from './tbos-report-data';
import type { AssessmentResult, ProposalResult } from './pdf-service';
import type { AssessmentData } from './validations';

type Node = { type: string; value?: string; box: { top: number; left: number; height: number; width: number }; style?: { fontSize?: number; lineHeight?: number }; props?: { render?: unknown }; children?: Node[]; lines?: { box: { height: number } }[] };
const nodes = (n: Node): Node[] => [n, ...(n.children || []).flatMap(nodes)];
const content = (n: Node): string => [n.value || '', ...(n.children || []).map(content)].join(' ');
const paragraph = 'Tim menyelaraskan prioritas lintas fungsi, membagi tanggung jawab, dan meninjau bukti penerapan secara berkala. ';
const form = { name: 'Peserta Sintetis', email: 'sample@example.invalid', company: 'Organisasi Contoh untuk Pengujian PDF', employees: '100 karyawan', challenge: paragraph, answers: {}, locale: 'id' } as AssessmentData;
const result: AssessmentResult = { scores: { Insights: 78, Lab: 64, Coach: 72, Play: 58, Academy: 69, Works: 55, Impact: 74, overall: 67 }, category: 'Profesional', aiAnalysis: paragraph.repeat(6) + 'AKHIR ANALISIS', scoreInterpretation: paragraph.repeat(2), recommendations: Array.from({ length: 5 }, (_, i) => ({ title: `Prioritas pengembangan ${i + 1}`, description: paragraph.repeat(2) + `AKHIR REKOMENDASI ${i + 1}`, diagnosis: paragraph, priority: 'Tinggi', service: 'BinaWorks' })) };
const solution = { code: 'SS-CONTOH', name: 'Program Kolaborasi Tim', competencies: ['Collaboration', 'Communication'], evidence: [{ need: paragraph, objective: paragraph }], outputs: ['Rencana penerapan kerja bersama.'], components: ['Praktik kolaborasi dan refleksi terfasilitasi.'] };
const spin: SpinReport = { version: 'spin-report-v3-v1', reference: 'SYNTHETIC-REPORT', issuedAt: '2026-11-02T03:00:00Z', company: form.company, summary: { situation: '100 karyawan; 30 target peserta.', problem: paragraph.repeat(3), impact: paragraph.repeat(2), outcome: paragraph.repeat(2) }, snapshot: [{ label: 'Konteks', value: paragraph.repeat(2) }], solutions: [solution], investments: [{ name: solution.name, baseAmountIdr: 25000000, duration: '1 hari', capacity: '30 target peserta', included: ['Fasilitasi', 'Bahan pembelajaran'], note: 'Investasi indikatif, dikonfirmasi sebelum pelaksanaan.' }], confirmations: ['Selaraskan sasaran dan jadwal.'], nextStep: 'Diskusi kebutuhan', bookingUrl: null, taxNote: 'Pajak dikonfirmasi terpisah.', disclaimer: 'Rekomendasi awal, bukan penawaran final.' };
const proposal: ProposalResult = { opening: paragraph.repeat(3), proposedProgram: 'Program Pengembangan Kolaborasi', documentKind: 'commercial', scope: [paragraph, paragraph], selectedSolutions: [{ code: 'SS-CONTOH', name: solution.name, focus: paragraph }], learningObjectives: [paragraph], deliverables: ['Rencana penerapan tim'], nextStep: 'Konfirmasi ruang lingkup bersama BinaHub.', commercialSnapshot: { items: Array.from({ length: 12 }, (_, i) => ({ name: `Komponen program ${i + 1}`, quantity: 1, pricingUnit: 'program', basePrice: 2500000, lineTotal: 2500000 })), subtotal: 30000000, discountPercent: 0, discountAmount: 0, totalBeforeTax: 30000000, currency: 'IDR', validityDays: 14 } };
const teams = Array.from({ length: 16 }, (_, i) => ({ id: `t-${i}`, name: `Tim Sintetis ${i + 1}`, batch: 'Batch Contoh', members: Array.from({ length: 16 }, (_, j) => ({ name: `Anggota contoh dengan nama panjang ${j + 1}`, isCaptain: j === 0 })) }));
const tbos = buildTbosProgramReport({ program: { id: 'synthetic', code: 'QA-PDF', title: 'Program Pengujian Tata Letak', startDate: null, endDate: null }, teams, observations: teams.map(t => ({ id: t.id, teamId: t.id, missionCode: 'contoh', missionName: 'Observasi kerja sama', facilitatorName: 'Pendamping Contoh', status: 'submitted', observedAt: '2026-11-02T03:00:00Z', submittedAt: '2026-11-02T03:00:00Z', notes: paragraph.repeat(12) + 'AKHIR CATATAN', scores: TBOS_REPORT_DIMENSIONS.map(d => ({ dimensionCode: d.code, dimensionName: d.name, levelValue: 3 })) })), generatedAt: '2026-11-02T03:00:00Z' });

async function check(name: string, document: React.ReactElement, expected: string[]) {
  let pages: Node[] = [];
  const resolved = (document.type as (props: unknown) => React.ReactElement<DocumentProps>)(document.props);
  const buffer = await renderToBuffer(React.cloneElement(resolved, { onRender: (props: unknown) => { pages = (props as { _INTERNAL__LAYOUT__DATA_: { children: Node[] } })._INTERNAL__LAYOUT__DATA_.children; } }));
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  const all = pages.map(content).join(' ').replace(/\s+/g, ' ');
  expected.forEach(text => expect(all).toContain(text));
  for (const [i, page] of pages.entries()) {
    expect(nodes(page).some(n => n.type === 'IMAGE'), `${name} page ${i + 1} original logo`).toBe(true);
    expect(nodes(page).some(n => n.props?.render && content(n).includes(`${i + 1} / ${pages.length}`)), `${name} page ${i + 1} footer`).toBe(true);
    if(name.startsWith('tbos') && content(page).includes('Catatan Observasi')) expect(content(page)).toContain('Fasilitator:');
    for (const node of nodes(page).filter(n => n.type === 'TEXT' && n.lines?.length && n.style?.fontSize)) {
      expect(node.style?.lineHeight, `${name} stable leading`).toBeUndefined();
      for (const line of node.lines!) expect(line.box.height).toBeLessThanOrEqual(node.style!.fontSize! * 1.65);
    }
  }
  if (process.env.PDF_LAYOUT_QA_DIR) {
    mkdirSync(process.env.PDF_LAYOUT_QA_DIR, { recursive: true });
    writeFileSync(path.join(process.env.PDF_LAYOUT_QA_DIR, name + '.pdf'), buffer);
    const compact = (n: Node): unknown => ({ type:n.type,value:n.value,box:n.box,style:{fontSize:n.style?.fontSize},children:n.children?.map(compact) });
    writeFileSync(path.join(process.env.PDF_LAYOUT_QA_DIR, name + '.layout.json'), JSON.stringify(pages.map(compact)));
  }
}
describe('Shared BinaHub PDF layout', () => {
  it.each(['id', 'en'] as const)('preserves organization report data and long text in %s', async locale => {
    await check(`diagnosis-${locale}`, <EnterpriseAssessmentReport formData={form} result={result} locale={locale} />, ['AKHIR ANALISIS', 'AKHIR REKOMENDASI 5', '67']);
  }, 30000);
  it.each(['commercial', 'preliminary'] as const)('paginates %s proposal rows and final section', async documentKind => {
    await check(`proposal-${documentKind}`, <SignatureProposalReport formData={form} proposal={{ ...proposal, documentKind }} issuedAt="2026-11-02T03:00:00Z" />, ['Komponen program 12', 'Konfirmasi ruang lingkup bersama BinaHub.']);
  }, 30000);
  it.each([true, false])('renders the recommendation with/without catalog options: %s', async matched => {
    await check(matched ? 'rekomendasi' : 'rekomendasi-belum-ditetapkan', <SpinPDF report={matched ? spin : { ...spin, solutions: [], investments: [] }} />, ['Rekomendasi pengembangan organisasi', 'Ringkasan dan rincian pengisian']);
  }, 30000);
  it('preserves a long questionnaire answer across pages', async () => {
    const questions = [{ id: 'q1', position: 1, question_type: 'long_text', prompt: 'Apa yang akan Anda terapkan?', required: true, options: null, correct_answer: null, points: 0, scale_min: null, scale_max: null }];
    await check('kuesioner', <ProgramQuestionnaireReportDocument program={{ code: 'QA-PDF', title: 'Program Contoh' }} questionnaire={{ title: 'Refleksi Pembelajaran', kind: 'binainsight', passing_score: null }} questions={questions} submissions={[{ id: 's1', participantName: 'Peserta Contoh', participantEmail: null, attemptNumber: 1, submittedAt: '2026-11-02T03:00:00Z', score: null, maximumScore: null, percentage: null, answers: [{ questionId: 'q1', value: paragraph.repeat(60) + 'AKHIR JAWABAN' }], evaluations: [] }]} />, ['AKHIR JAWABAN']);
  }, 30000);
  it('preserves long team notes and multi-page rosters', async () => {
    await check('tbos-tim-panjang', <TbosTeamReportDocument report={tbos} team={tbos.teams[0]} />, ['AKHIR CATATAN', 'Anggota contoh dengan nama panjang 16']);
  }, 30000);
  it('keeps an observation heading with its first short note near a page boundary', async () => {
    const team={...tbos.teams[0],members:tbos.teams[0].members.slice(0,10),missions:tbos.teams[0].missions.map(m=>({...m,notes:'Catatan singkat untuk pengujian batas halaman.'}))};
    await check('tbos-tim-catatan-singkat', <TbosTeamReportDocument report={tbos} team={team}/>, ['Catatan Observasi','Catatan singkat untuk pengujian batas halaman.']);
  }, 30000);
  it('repeats table headings and retains all teams in a large group', async () => {
    await check('tbos-grup-panjang', <TbosGroupReportDocument report={tbos} />, ['Tim Sintetis 16', 'AKHIR CATATAN']);
  }, 60000);
});
