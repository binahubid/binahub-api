import React from 'react';
import { Circle, Document, Line, Page, Polygon, StyleSheet, Svg, Text, View } from '@react-pdf/renderer';
import type { Locale } from '@/i18n/config';
import type { AssessmentResult } from './pdf-service';
import { DIMENSIONS, type AssessmentData } from './validations';

const NAVY = '#0A285F';
const INK = '#152033';
const GOLD = '#C9952E';
const SLATE = '#58657A';
const MUTED = '#8793A6';
const LINE_COLOR = '#D8DEE8';
const PAPER = '#FFFFFF';
const WASH = '#F3F5F8';

const MATURITY_LEVELS = [
  { label: 'Pemula', min: 0, max: 39 },
  { label: 'Berkembang', min: 40, max: 60 },
  { label: 'Profesional', min: 61, max: 80 },
  { label: 'Unggulan', min: 81, max: 100 },
];

const MATURITY_LEVELS_EN = [
  { label: 'Starter', min: 0, max: 39 },
  { label: 'Developing', min: 40, max: 60 },
  { label: 'Professional', min: 61, max: 80 },
  { label: 'Leading', min: 81, max: 100 },
];

function copyFor(locale: Locale) {
  return locale === 'en'
    ? {
        dateLocale: 'en-US',
        report: 'ORGANIZATIONAL DIAGNOSTIC REPORT',
        title: 'Strategic Maturity',
        titleAccent: 'Executive Review',
        preparedFor: 'PREPARED FOR',
        company: 'ORGANIZATION',
        issued: 'ISSUED',
        confidentiality: 'CLASSIFICATION',
        confidential: 'CONFIDENTIAL',
        overall: 'OVERALL INDEX',
        maturity: 'MATURITY STAGE',
        team: 'TEAM SCALE',
        scope: 'DIAGNOSTIC SCOPE',
        dimensions: '7 DIMENSIONS / 49 CRITERIA',
        executiveProfile: 'EXECUTIVE PROFILE',
        maturityModel: 'ORGANIZATIONAL MATURITY MODEL',
        nextStage: 'NEXT STAGE',
        gap: 'POINT GAP',
        strongest: 'STRONGEST SIGNAL',
        priority: 'PRIORITY SIGNAL',
        diagnosticMap: 'Diagnostic Intelligence Map',
        diagnosticMapSub: 'Distribution, balance, and cross-dimensional reading',
        scoreDistribution: 'SCORE DISTRIBUTION',
        portfolio: 'DIMENSION PORTFOLIO',
        crossReading: 'CROSS-DIMENSIONAL READING',
        risk: '12-18 MONTH RISK OUTLOOK',
        strategicPriorities: 'Strategic Priorities',
        strategicPrioritiesSub: 'Executive interpretation and the first 90-day focus',
        executiveSummary: 'EXECUTIVE SUMMARY',
        priorityActions: 'PRIORITY ACTIONS',
        strategicDirection: 'STRATEGIC DIRECTION',
        roadmap: 'Transformation Roadmap',
        roadmapSub: 'Supporting initiatives and implementation cadence',
        supportingInitiatives: 'SUPPORTING INITIATIVES',
        implementation: '90-DAY IMPLEMENTATION CADENCE',
        nextStep: 'RECOMMENDED NEXT STEP',
        nextStepText: 'Review these findings with the BinaHub team and convert the selected priorities into a governed implementation plan, with clear owners, decision rights, and measurable outcomes.',
        phases: [
          { period: 'DAY 0-30', title: 'Align', text: 'Confirm priorities, owners, success measures, and the first process to improve.' },
          { period: 'DAY 31-60', title: 'Pilot', text: 'Test the operating rhythm in a controlled scope and document decisions and evidence.' },
          { period: 'DAY 61-90', title: 'Review and scale', text: 'Evaluate adoption and business impact, then standardize the practices that work.' },
        ],
        footer: 'BinaHub / Human Synergy Partner / Confidential',
        page: 'PAGE',
      }
    : {
        dateLocale: 'id-ID',
        report: 'LAPORAN DIAGNOSTIK ORGANISASI',
        title: 'Kematangan Strategis',
        titleAccent: 'Tinjauan Eksekutif',
        preparedFor: 'DISUSUN UNTUK',
        company: 'ORGANISASI',
        issued: 'DITERBITKAN',
        confidentiality: 'KLASIFIKASI',
        confidential: 'RAHASIA',
        overall: 'INDEKS KESELURUHAN',
        maturity: 'TAHAP KEMATANGAN',
        team: 'SKALA TIM',
        scope: 'CAKUPAN DIAGNOSTIK',
        dimensions: '7 DIMENSI / 49 KRITERIA',
        executiveProfile: 'PROFIL EKSEKUTIF',
        maturityModel: 'MODEL KEMATANGAN ORGANISASI',
        nextStage: 'TAHAP BERIKUTNYA',
        gap: 'SELISIH POIN',
        strongest: 'SINYAL TERKUAT',
        priority: 'SINYAL PRIORITAS',
        diagnosticMap: 'Peta Intelijen Diagnostik',
        diagnosticMapSub: 'Distribusi, keseimbangan, dan pembacaan lintas dimensi',
        scoreDistribution: 'DISTRIBUSI SKOR',
        portfolio: 'PORTOFOLIO DIMENSI',
        crossReading: 'PEMBACAAN LINTAS DIMENSI',
        risk: 'PROYEKSI RISIKO 12-18 BULAN',
        strategicPriorities: 'Prioritas Strategis',
        strategicPrioritiesSub: 'Interpretasi eksekutif dan fokus awal 90 hari',
        executiveSummary: 'RINGKASAN EKSEKUTIF',
        priorityActions: 'TINDAKAN PRIORITAS',
        strategicDirection: 'ARAH STRATEGIS',
        roadmap: 'Roadmap Transformasi',
        roadmapSub: 'Inisiatif pendukung dan ritme implementasi',
        supportingInitiatives: 'INISIATIF PENDUKUNG',
        implementation: 'RITME IMPLEMENTASI 90 HARI',
        nextStep: 'LANGKAH YANG DIREKOMENDASIKAN',
        nextStepText: 'Tinjau temuan ini bersama tim BinaHub dan terjemahkan prioritas terpilih menjadi rencana implementasi yang memiliki owner, hak keputusan, dan ukuran hasil yang jelas.',
        phases: [
          { period: 'HARI 0-30', title: 'Selaraskan', text: 'Konfirmasi prioritas, owner, ukuran keberhasilan, dan proses pertama yang akan diperbaiki.' },
          { period: 'HARI 31-60', title: 'Uji terbatas', text: 'Uji ritme kerja pada lingkup terkendali dan dokumentasikan keputusan serta bukti.' },
          { period: 'HARI 61-90', title: 'Tinjau dan perluas', text: 'Evaluasi adopsi dan dampak bisnis, lalu standardisasi praktik yang terbukti efektif.' },
        ],
        footer: 'BinaHub / Human Synergy Partner / Dokumen Rahasia',
        page: 'HALAMAN',
      };
}

function cleanText(text = '') {
  return text
    .normalize('NFC')
    .replace(/([a-zà-ÿ])([A-Z])/g, '$1 $2')
    .replace(/([.!?])(?=[A-ZÀ-Ý])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

const styles = StyleSheet.create({
  page: { backgroundColor: PAPER, color: INK, fontFamily: 'Inter' },
  coverHero: { height: 252, backgroundColor: NAVY, padding: '28 44 24 44', color: '#FFFFFF' },
  coverTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  wordmark: { flexDirection: 'row', alignItems: 'baseline' },
  wordmarkMain: { fontSize: 16, color: '#FFFFFF', fontWeight: 700 },
  wordmarkAccent: { fontSize: 16, color: GOLD, fontWeight: 700 },
  wordmarkTag: { marginLeft: 8, fontSize: 5.2, color: '#B9C5D6', fontWeight: 600, letterSpacing: 1.1 },
  documentId: { fontSize: 6.5, color: '#B9C5D6', letterSpacing: 1.2 },
  coverEyebrow: { marginTop: 34, fontSize: 7.5, color: GOLD, fontWeight: 700, letterSpacing: 2.1 },
  coverTitle: { marginTop: 10, fontSize: 28, lineHeight: 1.02, color: '#FFFFFF', fontWeight: 600 },
  coverTitleAccent: { marginTop: 3, fontSize: 28, lineHeight: 1.02, color: GOLD, fontWeight: 600 },
  coverRule: { marginTop: 18, width: 54, height: 2, backgroundColor: GOLD },
  coverMeta: { marginTop: 23, flexDirection: 'row', borderTopWidth: 0.6, borderTopColor: '#506790', paddingTop: 13 },
  coverMetaCell: { width: '25%', paddingRight: 12 },
  coverMetaLabel: { fontSize: 5.8, color: '#99A9C0', fontWeight: 600, letterSpacing: 1 },
  coverMetaValue: { marginTop: 5, fontSize: 7.5, color: '#FFFFFF', fontWeight: 600, lineHeight: 1.25 },
  coverBody: { padding: '24 44 52 44' },
  metricRail: { flexDirection: 'row', borderTopWidth: 0.7, borderBottomWidth: 0.7, borderColor: LINE_COLOR, paddingVertical: 15 },
  metricCell: { width: '25%', minHeight: 54, paddingRight: 13, paddingLeft: 13, borderRightWidth: 0.6, borderRightColor: LINE_COLOR },
  metricCellFirst: { paddingLeft: 0 },
  metricCellLast: { borderRightWidth: 0, paddingRight: 0 },
  metricLabel: { fontSize: 5.8, color: MUTED, fontWeight: 700, letterSpacing: 0.9 },
  metricValueLarge: { marginTop: 5, fontSize: 23, color: NAVY, fontWeight: 600 },
  metricValue: { marginTop: 7, fontSize: 11, color: NAVY, fontWeight: 600, lineHeight: 1.25 },
  sectionKicker: { fontSize: 6.2, color: GOLD, fontWeight: 700, letterSpacing: 1.4 },
  sectionHeading: { marginTop: 5, fontSize: 17, color: NAVY, fontWeight: 600 },
  profileGrid: { marginTop: 26, flexDirection: 'row', gap: 28 },
  profileLead: { width: '34%' },
  profileBody: { flex: 1 },
  profileArchetype: { marginTop: 8, fontSize: 17, color: INK, fontWeight: 600, lineHeight: 1.2 },
  bodyText: { fontSize: 8.5, lineHeight: 1.55, color: SLATE },
  maturityBlock: { marginTop: 25, borderTopWidth: 0.7, borderBottomWidth: 0.7, borderColor: LINE_COLOR, paddingVertical: 14 },
  maturityTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  maturityTitle: { marginTop: 5, fontSize: 13, color: NAVY, fontWeight: 600 },
  maturityMeta: { fontSize: 7, color: SLATE, textAlign: 'right', lineHeight: 1.4 },
  maturityTrack: { marginTop: 13, flexDirection: 'row' },
  maturityStep: { flex: 1, height: 29, justifyContent: 'center', alignItems: 'center', backgroundColor: WASH, borderRightWidth: 2, borderRightColor: PAPER },
  maturityStepActive: { backgroundColor: NAVY },
  maturityStepText: { fontSize: 6.5, color: SLATE, fontWeight: 700 },
  maturityStepTextActive: { color: '#FFFFFF' },
  signalGrid: { marginTop: 25, flexDirection: 'row', gap: 28 },
  signal: { flex: 1, borderTopWidth: 0.7, borderTopColor: LINE_COLOR, paddingTop: 11 },
  signalIndex: { fontSize: 6, color: GOLD, fontWeight: 700, letterSpacing: 1 },
  signalTitle: { marginTop: 6, fontSize: 13, color: NAVY, fontWeight: 600 },
  signalText: { marginTop: 5, fontSize: 7.5, color: SLATE, lineHeight: 1.45 },
  header: { height: 78, padding: '18 44 12 44', borderBottomWidth: 0.8, borderBottomColor: LINE_COLOR, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  headerLeft: { width: '64%' },
  headerTitle: { marginTop: 4, fontSize: 16, color: NAVY, fontWeight: 600 },
  headerSubtitle: { marginTop: 3, fontSize: 6.8, color: SLATE },
  headerSectionNo: { fontSize: 25, color: '#DCE2EA', fontWeight: 600 },
  content: { padding: '24 44 54 44' },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderBottomWidth: 1.1, borderBottomColor: NAVY, paddingBottom: 8 },
  sectionTitleText: { fontSize: 8, color: NAVY, fontWeight: 700, letterSpacing: 1.2 },
  sectionTitleNote: { fontSize: 6.2, color: MUTED },
  diagnosticGrid: { marginTop: 18, flexDirection: 'row' },
  radarColumn: { width: '44%', paddingRight: 24, borderRightWidth: 0.7, borderRightColor: LINE_COLOR },
  barsColumn: { flex: 1, paddingLeft: 24 },
  blockLabel: { fontSize: 6, color: MUTED, fontWeight: 700, letterSpacing: 1 },
  radarLegend: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  radarLegendItem: { width: '31%', borderTopWidth: 0.5, borderTopColor: LINE_COLOR, paddingTop: 4 },
  radarLegendLabel: { fontSize: 5.3, color: MUTED },
  radarLegendValue: { marginTop: 2, fontSize: 7, color: NAVY, fontWeight: 700 },
  barRow: { marginTop: 12 },
  barTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  barLabel: { fontSize: 7.5, color: INK, fontWeight: 500 },
  barValue: { fontSize: 7.5, color: NAVY, fontWeight: 700 },
  barTrack: { marginTop: 4, height: 3, backgroundColor: '#E9EDF2' },
  barFill: { height: 3, backgroundColor: NAVY },
  insightSection: { marginTop: 24 },
  insightRow: { flexDirection: 'row', borderTopWidth: 0.6, borderTopColor: LINE_COLOR, paddingVertical: 12 },
  insightNumber: { width: 42, fontSize: 18, color: GOLD, fontWeight: 300 },
  insightText: { flex: 1, fontSize: 8.4, color: SLATE, lineHeight: 1.5 },
  darkPanel: { marginTop: 16, backgroundColor: NAVY, padding: '15 18' },
  darkPanelLabel: { fontSize: 6, color: GOLD, fontWeight: 700, letterSpacing: 1.1 },
  darkPanelText: { marginTop: 8, fontSize: 9.2, color: '#FFFFFF', lineHeight: 1.5 },
  summaryGrid: { marginTop: 18, flexDirection: 'row', gap: 28 },
  summaryLead: { width: '28%' },
  summaryCopy: { flex: 1, fontSize: 9, lineHeight: 1.6, color: SLATE },
  priorities: { marginTop: 24 },
  priorityRow: { flexDirection: 'row', borderTopWidth: 0.7, borderTopColor: LINE_COLOR, paddingVertical: 12 },
  priorityIndex: { width: 48, fontSize: 23, color: '#CCD3DE', fontWeight: 300 },
  priorityMain: { width: '36%', paddingRight: 18 },
  priorityService: { fontSize: 5.8, color: GOLD, fontWeight: 700, letterSpacing: 0.8 },
  priorityTitle: { marginTop: 4, fontSize: 10, color: NAVY, fontWeight: 600, lineHeight: 1.3 },
  priorityDetail: { flex: 1 },
  priorityDiagnosis: { fontSize: 7.4, color: INK, fontWeight: 500, lineHeight: 1.4 },
  priorityDescription: { marginTop: 5, fontSize: 7.4, color: SLATE, lineHeight: 1.45 },
  roadmapRows: { marginTop: 16 },
  timeline: { marginTop: 22, flexDirection: 'row', borderTopWidth: 0.8, borderBottomWidth: 0.8, borderColor: LINE_COLOR, paddingVertical: 14 },
  timelinePhase: { flex: 1, minHeight: 94, paddingHorizontal: 14, borderRightWidth: 0.6, borderRightColor: LINE_COLOR },
  timelineFirst: { paddingLeft: 0 },
  timelineLast: { paddingRight: 0, borderRightWidth: 0 },
  timelinePeriod: { fontSize: 5.8, color: GOLD, fontWeight: 700, letterSpacing: 0.8 },
  timelineTitle: { marginTop: 6, fontSize: 10.5, color: NAVY, fontWeight: 600 },
  timelineText: { marginTop: 7, fontSize: 7.2, color: SLATE, lineHeight: 1.45 },
  nextStepBlock: { marginTop: 24, backgroundColor: WASH, padding: '18 20', borderTopWidth: 1.2, borderBottomWidth: 1.2, borderColor: NAVY },
  nextStepLabel: { fontSize: 6, color: GOLD, fontWeight: 700, letterSpacing: 1.1 },
  nextStepText: { marginTop: 8, fontSize: 9.2, color: INK, lineHeight: 1.55 },
});

function Wordmark() {
  return (
    <View style={styles.wordmark}>
      <Text style={styles.wordmarkMain}>Bina</Text>
      <Text style={styles.wordmarkAccent}>Hub</Text>
      <Text style={styles.wordmarkTag}>HUMAN SYNERGY PARTNER</Text>
    </View>
  );
}

function ReportHeader({ section, title, subtitle }: { section: string; title: string; subtitle: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.headerSectionNo}>{section}</Text>
    </View>
  );
}

function PriorityRow({
  index,
  recommendation,
}: {
  index: number;
  recommendation: AssessmentResult['recommendations'][number];
}) {
  return (
    <View style={styles.priorityRow} wrap={false}>
      <Text style={styles.priorityIndex}>{String(index).padStart(2, '0')}</Text>
      <View style={styles.priorityMain}>
        <Text style={styles.priorityService}>{cleanText(recommendation.service).toUpperCase()}</Text>
        <Text style={styles.priorityTitle}>{cleanText(recommendation.title)}</Text>
      </View>
      <View style={styles.priorityDetail}>
        {recommendation.diagnosis ? <Text style={styles.priorityDiagnosis}>{cleanText(recommendation.diagnosis)}</Text> : null}
        <Text style={styles.priorityDescription}>{cleanText(recommendation.description)}</Text>
      </View>
    </View>
  );
}

export function EnterpriseAssessmentReport({
  formData,
  result,
  locale = 'id',
}: {
  formData: AssessmentData;
  result: AssessmentResult;
  locale?: Locale;
}) {
  const copy = copyFor(locale);
  const scores = result.scores;
  const rankedDimensions = [...DIMENSIONS].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const strongest = rankedDimensions[0];
  const priority = rankedDimensions[rankedDimensions.length - 1];
  const levels = locale === 'en' ? MATURITY_LEVELS_EN : MATURITY_LEVELS;
  const maturity = levels.find((level) => scores.overall >= level.min && scores.overall <= level.max) || levels[0];
  const nextMaturity = levels.find((level) => scores.overall < level.min) || null;
  const gap = nextMaturity ? Math.max(0, nextMaturity.min - scores.overall) : 0;
  const issueDate = new Date().toLocaleDateString(copy.dateLocale, { day: 'numeric', month: 'long', year: 'numeric' });
  const scoreInterpretation = cleanText(result.scoreInterpretation || (locale === 'en'
    ? `${formData.company} is currently in the ${result.category} category, with relative strength in ${strongest} and a strengthening priority in ${priority}.`
    : `${formData.company} berada pada kategori ${result.category}, dengan kekuatan relatif pada ${strongest} dan prioritas penguatan pada ${priority}.`));
  const crossInsights = result.crossDimensionalInsights?.length ? result.crossDimensionalInsights : [
    locale === 'en'
      ? `${strongest} is a relative strength, while ${priority} is the priority area to address.`
      : `${strongest} menjadi kekuatan relatif, sementara ${priority} menjadi area prioritas yang perlu ditangani.`,
    locale === 'en'
      ? 'The distribution suggests a need to connect strategic potential with a more consistent implementation discipline.'
      : 'Distribusi skor menunjukkan perlunya menghubungkan potensi strategis dengan disiplin implementasi yang lebih konsisten.',
  ];
  const riskProjection = cleanText(result.riskProjection || (locale === 'en'
    ? `If ${priority} is not strengthened, the organization risks slower execution as growth demands increase.`
    : `Jika ${priority} tidak diperkuat, organisasi berisiko mengalami perlambatan eksekusi saat tuntutan pertumbuhan meningkat.`));
  const strategicKey = cleanText(result.strategicKey || (locale === 'en'
    ? `Over the next 90 days, strengthen ${priority} and connect it to a measurable operating rhythm.`
    : `Dalam 90 hari ke depan, perkuat ${priority} dan hubungkan prioritas tersebut dengan ritme kerja yang terukur.`));
  const primaryRecommendations = result.recommendations.slice(0, 3);
  const secondaryRecommendations = result.recommendations.slice(3);
  const angleStep = (2 * Math.PI) / DIMENSIONS.length;
  const radarCenter = 80;
  const radarRadius = 56;
  const radarPoints = DIMENSIONS.map((dimension, index) => {
    const angle = index * angleStep - Math.PI / 2;
    const radius = radarRadius * ((scores[dimension] || 0) / 100);
    return `${radarCenter + radius * Math.cos(angle)},${radarCenter + radius * Math.sin(angle)}`;
  }).join(' ');

  return (
    <Document title={`${locale === 'en' ? 'Diagnostic Report' : 'Laporan Diagnostik'} - ${formData.company}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.coverHero}>
          <View style={styles.coverTop}>
            <Wordmark />
            <Text style={styles.documentId}>BI / {new Date().getFullYear()} / EXECUTIVE</Text>
          </View>
          <Text style={styles.coverEyebrow}>{copy.report}</Text>
          <Text style={styles.coverTitle}>{copy.title}</Text>
          <Text style={styles.coverTitleAccent}>{copy.titleAccent}</Text>
          <View style={styles.coverRule} />
          <View style={styles.coverMeta}>
            {[
              [copy.preparedFor, formData.name.toUpperCase()],
              [copy.company, formData.company.toUpperCase()],
              [copy.issued, issueDate.toUpperCase()],
              [copy.confidentiality, copy.confidential],
            ].map(([label, value]) => (
              <View key={label} style={styles.coverMetaCell}>
                <Text style={styles.coverMetaLabel}>{label}</Text>
                <Text style={styles.coverMetaValue}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.coverBody}>
          <View style={styles.metricRail}>
            <View style={[styles.metricCell, styles.metricCellFirst]}>
              <Text style={styles.metricLabel}>{copy.overall}</Text>
              <Text style={styles.metricValueLarge}>{scores.overall}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>{copy.maturity}</Text>
              <Text style={styles.metricValue}>{result.category}</Text>
            </View>
            <View style={styles.metricCell}>
              <Text style={styles.metricLabel}>{copy.team}</Text>
              <Text style={styles.metricValue}>{formData.employees || '-'}</Text>
            </View>
            <View style={[styles.metricCell, styles.metricCellLast]}>
              <Text style={styles.metricLabel}>{copy.scope}</Text>
              <Text style={styles.metricValue}>{copy.dimensions}</Text>
            </View>
          </View>

          <View style={styles.profileGrid}>
            <View style={styles.profileLead}>
              <Text style={styles.sectionKicker}>{copy.executiveProfile}</Text>
              <Text style={styles.profileArchetype}>{result.archetype || (locale === 'en' ? 'Strategic Builder' : 'Pembangun Strategis')}</Text>
            </View>
            <View style={styles.profileBody}>
              <Text style={styles.bodyText}>{scoreInterpretation}</Text>
            </View>
          </View>

          <View style={styles.maturityBlock}>
            <View style={styles.maturityTop}>
              <View>
                <Text style={styles.sectionKicker}>{copy.maturityModel}</Text>
                <Text style={styles.maturityTitle}>{maturity.label}</Text>
              </View>
              <Text style={styles.maturityMeta}>
                {nextMaturity ? `${copy.nextStage}: ${nextMaturity.label}\n${copy.gap}: +${gap}` : `${copy.nextStage}: -\n${copy.gap}: -`}
              </Text>
            </View>
            <View style={styles.maturityTrack}>
              {levels.map((level) => {
                const active = level.label === maturity.label;
                return (
                  <View key={level.label} style={[styles.maturityStep, active ? styles.maturityStepActive : {}]}>
                    <Text style={[styles.maturityStepText, active ? styles.maturityStepTextActive : {}]}>{level.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.signalGrid}>
            <View style={styles.signal}>
              <Text style={styles.signalIndex}>01 / {copy.strongest}</Text>
              <Text style={styles.signalTitle}>{strongest}</Text>
              <Text style={styles.signalText}>{locale === 'en' ? 'Highest-performing dimension in the current assessment portfolio.' : 'Dimensi dengan performa tertinggi dalam portofolio assessment saat ini.'}</Text>
            </View>
            <View style={styles.signal}>
              <Text style={styles.signalIndex}>02 / {copy.priority}</Text>
              <Text style={styles.signalTitle}>{priority}</Text>
              <Text style={styles.signalText}>{locale === 'en' ? 'The dimension most likely to constrain the next stage of execution.' : 'Dimensi yang paling berpotensi membatasi tahap eksekusi berikutnya.'}</Text>
            </View>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <ReportHeader section="02" title={copy.diagnosticMap} subtitle={copy.diagnosticMapSub} />
        <View style={styles.content}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitleText}>{copy.scoreDistribution}</Text>
            <Text style={styles.sectionTitleNote}>{copy.dimensions}</Text>
          </View>

          <View style={styles.diagnosticGrid} wrap={false}>
            <View style={styles.radarColumn}>
              <Text style={styles.blockLabel}>{locale === 'en' ? 'BALANCE INDEX' : 'INDEKS KESEIMBANGAN'}</Text>
              <Svg width="190" height="190" viewBox="0 0 160 160" style={{ marginTop: 7, alignSelf: 'center' }}>
                {[0.25, 0.5, 0.75, 1].map((scale) => {
                  const points = DIMENSIONS.map((_, index) => {
                    const angle = index * angleStep - Math.PI / 2;
                    const radius = radarRadius * scale;
                    return `${radarCenter + radius * Math.cos(angle)},${radarCenter + radius * Math.sin(angle)}`;
                  }).join(' ');
                  return <Polygon key={scale} points={points} fill="none" stroke={LINE_COLOR} strokeWidth="0.7" />;
                })}
                {DIMENSIONS.map((dimension, index) => {
                  const angle = index * angleStep - Math.PI / 2;
                  return (
                    <Line
                      key={dimension}
                      x1={radarCenter}
                      y1={radarCenter}
                      x2={radarCenter + radarRadius * Math.cos(angle)}
                      y2={radarCenter + radarRadius * Math.sin(angle)}
                      stroke={LINE_COLOR}
                      strokeWidth="0.6"
                    />
                  );
                })}
                <Polygon points={radarPoints} fill="#DCE4F0" stroke={NAVY} strokeWidth="1.8" />
                <Circle cx={radarCenter} cy={radarCenter} r="2" fill={GOLD} />
              </Svg>
              <View style={styles.radarLegend}>
                {DIMENSIONS.map((dimension) => (
                  <View key={dimension} style={styles.radarLegendItem}>
                    <Text style={styles.radarLegendLabel}>{dimension.toUpperCase()}</Text>
                    <Text style={styles.radarLegendValue}>{scores[dimension] || 0}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={styles.barsColumn}>
              <Text style={styles.blockLabel}>{copy.portfolio}</Text>
              {DIMENSIONS.map((dimension) => (
                <View key={dimension} style={styles.barRow}>
                  <View style={styles.barTop}>
                    <Text style={styles.barLabel}>{dimension}</Text>
                    <Text style={styles.barValue}>{scores[dimension] || 0}</Text>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${scores[dimension] || 0}%`, backgroundColor: dimension === strongest ? GOLD : NAVY }]} />
                  </View>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.insightSection}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitleText}>{copy.crossReading}</Text>
              <Text style={styles.sectionTitleNote}>01-02</Text>
            </View>
            {crossInsights.slice(0, 2).map((insight, index) => (
              <View key={index} style={styles.insightRow} wrap={false}>
                <Text style={styles.insightNumber}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={styles.insightText}>{cleanText(insight)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.darkPanel} wrap={false}>
            <Text style={styles.darkPanelLabel}>{copy.risk}</Text>
            <Text style={styles.darkPanelText}>{riskProjection}</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <ReportHeader section="03" title={copy.strategicPriorities} subtitle={copy.strategicPrioritiesSub} />
        <View style={styles.content}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitleText}>{copy.executiveSummary}</Text>
            <Text style={styles.sectionTitleNote}>{result.category.toUpperCase()}</Text>
          </View>
          <View style={styles.summaryGrid} wrap={false}>
            <View style={styles.summaryLead}>
              <Text style={styles.sectionKicker}>{result.archetype || (locale === 'en' ? 'STRATEGIC BUILDER' : 'PEMBANGUN STRATEGIS')}</Text>
              <Text style={styles.sectionHeading}>{scores.overall} / 100</Text>
            </View>
            <Text style={styles.summaryCopy}>{cleanText(result.aiAnalysis)}</Text>
          </View>

          <View style={styles.priorities}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitleText}>{copy.priorityActions}</Text>
              <Text style={styles.sectionTitleNote}>01-03</Text>
            </View>
            {primaryRecommendations.map((recommendation, index) => (
              <PriorityRow key={`${recommendation.service}-${index}`} index={index + 1} recommendation={recommendation} />
            ))}
          </View>

          <View style={styles.darkPanel} wrap={false}>
            <Text style={styles.darkPanelLabel}>{copy.strategicDirection}</Text>
            <Text style={styles.darkPanelText}>{strategicKey}</Text>
          </View>
        </View>
      </Page>

      <Page size="A4" style={styles.page}>
        <ReportHeader section="04" title={copy.roadmap} subtitle={copy.roadmapSub} />
        <View style={styles.content}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitleText}>{copy.supportingInitiatives}</Text>
            <Text style={styles.sectionTitleNote}>04-{String(Math.max(4, result.recommendations.length)).padStart(2, '0')}</Text>
          </View>

          <View style={styles.roadmapRows}>
            {secondaryRecommendations.map((recommendation, index) => (
              <PriorityRow key={`${recommendation.service}-${index}`} index={index + 4} recommendation={recommendation} />
            ))}
          </View>

          <View style={{ marginTop: 24 }}>
            <View style={styles.sectionTitleRow}>
              <Text style={styles.sectionTitleText}>{copy.implementation}</Text>
              <Text style={styles.sectionTitleNote}>0-90</Text>
            </View>
            <View style={styles.timeline} wrap={false}>
              {copy.phases.map((phase, index) => (
                <View
                  key={phase.period}
                  style={[
                    styles.timelinePhase,
                    index === 0 ? styles.timelineFirst : {},
                    index === copy.phases.length - 1 ? styles.timelineLast : {},
                  ]}
                >
                  <Text style={styles.timelinePeriod}>{phase.period}</Text>
                  <Text style={styles.timelineTitle}>{phase.title}</Text>
                  <Text style={styles.timelineText}>{phase.text}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.nextStepBlock} wrap={false}>
            <Text style={styles.nextStepLabel}>{copy.nextStep}</Text>
            <Text style={styles.nextStepText}>{copy.nextStepText}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
