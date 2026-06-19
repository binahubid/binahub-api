import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Svg, Polygon, Circle, Image } from '@react-pdf/renderer';
import { AssessmentData, DIMENSIONS } from './validations';
import type { Locale } from '@/i18n/config';

Font.register({
  family: 'Inter',
  fonts: [
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyeMZhrib2Bg-4.ttf', fontWeight: 300 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuI6fMZhrib2Bg-4.ttf', fontWeight: 400 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuGKYMZhrib2Bg-4.ttf', fontWeight: 500 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuFuYMZhrib2Bg-4.ttf', fontWeight: 600 },
    { src: 'https://fonts.gstatic.com/s/inter/v12/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuDyYMZhrib2Bg-4.ttf', fontWeight: 700 },
  ],
});

export interface AssessmentResult {
  scores: Record<string, number> & { overall: number };
  category: string;
  aiAnalysis: string;
  archetype?: string;
  scoreInterpretation?: string;
  crossDimensionalInsights?: string[];
  riskProjection?: string;
  strategicKey?: string;
  recommendations: {
    title: string;
    diagnosis?: string;
    description: string;
    priority: string;
    service: string;
  }[];
}

export interface ProposalPackage {
  name: string;
  price: string;
  bestFor: string;
  duration: string;
  scope: string[];
  deliverables: string[];
}

export interface ProposalResult {
  subject?: string;
  opening?: string;
  proposedProgram?: string;
  scope?: string[];
  timeline?: string;
  investmentNote?: string;
  packages?: ProposalPackage[];
  nextStep?: string;
}

const NAVY = '#0B2C6B';
const GOLD = '#D9A441';
const ICE = '#F4F7FB';
const SILVER = '#8A9BB0';

const MATURITY_LEVELS = [
  { label: 'Awal', min: 0, max: 39 },
  { label: 'Berkembang', min: 40, max: 59 },
  { label: 'Profesional', min: 60, max: 74 },
  { label: 'Maju', min: 75, max: 89 },
  { label: 'Unggul', min: 90, max: 100 },
];

const MATURITY_LEVELS_EN = [
  { label: 'Starter', min: 0, max: 39 },
  { label: 'Developing', min: 40, max: 59 },
  { label: 'Professional', min: 60, max: 74 },
  { label: 'Advanced', min: 75, max: 89 },
  { label: 'Leading', min: 90, max: 100 },
];

function getPdfCopy(locale: Locale = 'id') {
  return locale === 'en'
    ? {
        localeDate: 'en-US',
        documentTitle: 'Diagnostic Report',
        compactSubtitle: 'Cross-dimensional reasoning Â· 7-dimension score distribution',
        fiscalYear: 'FISCAL YEAR',
        preparedFor: 'PREPARED FOR',
        company: 'COMPANY',
        issueDate: 'ISSUE DATE',
        overallScore: 'Overall Index Score',
        stage: 'Stage',
        totalDimensions: 'Total Dimensions',
        coreCriteria: 'Core Criteria',
        teamScale: 'Team Scale',
        organizationScale: 'Organization Scale',
        classification: 'Classification',
        confidential: 'Confidential',
        highPriority: 'High Priority',
        orgProfile: 'Organization Profile',
        strategicBuilder: 'Strategic Builder',
        maturityLadder: 'Organization Maturity Ladder',
        orgPrefix: 'Organization',
        nextEvolution: 'Next Evolution',
        gapToNext: 'Gap to Next Stage',
        currentStage: 'Current Stage',
        mainStrength: 'Main Strength',
        mainBottleneck: 'Main Bottleneck',
        strengthText: 'Strongest dimension based on assessment score distribution.',
        bottleneckText: 'Priority area that most determines the next acceleration.',
        executiveSummary: 'Executive Summary & Strategic Analysis',
        mapTitle: 'Diagnostic Intelligence Map',
        mapSectionTitle: 'Performance Map & 7-Dimension Organizational Analysis',
        mapSectionSubtitle: 'Score distribution visualization and operational efficiency comparison',
        balanceDistribution: 'Balance Distribution',
        scoreBoard: 'Performance Scoreboard',
        diagnosticReasoning: 'Diagnostic Reasoning',
        riskProjection: '12-18 Month Risk Projection',
        strategicOverview: 'Strategic Diagnostic Overview',
        strategicOverviewSubtitle: 'Main priorities Â· 90-day action focus',
        priorityActions: 'Priority Action Recommendations',
        priorityActionsSubtitle: 'Top three priorities based on the BinaHub 7-dimension diagnostic result',
        strategy: 'STRATEGY',
        consultantKey: 'Strategic Key from the Consulting Team',
        roadmapTitle: 'Transformation Roadmap',
        roadmapSubtitle: 'Follow-up roadmap Â· next consultation steps',
        roadmapSection: 'Follow-up Roadmap & Next Steps',
        roadmapSectionSubtitle: 'Supporting recommendations to strengthen implementation rhythm after the main priorities begin',
        nextSteps: 'Next Steps',
        nextStepsText: 'Discuss this result with the BinaHub team to translate diagnostic priorities into an implementation roadmap that fits your organization context.',
        footer: 'Â© 2025 BinaHub Â· Strategic Transformation Division Â· Confidential Document',
        page: 'Page',
        of: 'of',
        reportHeaderLabel: 'Performance Diagnostic Report',
        reportHeaderTitle: 'Human Synergy &',
        reportHeaderSubtitle: 'Strategic Maturity Diagnostic',
        maturityLevels: MATURITY_LEVELS_EN,
      }
    : {
        localeDate: 'id-ID',
        documentTitle: 'Laporan Diagnostik',
        compactSubtitle: 'Penalaran lintas dimensi Â· distribusi skor 7 dimensi',
        fiscalYear: 'TAHUN FISKAL',
        preparedFor: 'DISUSUN UNTUK',
        company: 'PERUSAHAAN',
        issueDate: 'TANGGAL ISU',
        overallScore: 'Skor Indeks Keseluruhan',
        stage: 'Tahap',
        totalDimensions: 'Total Dimensi',
        coreCriteria: 'Kriteria Inti',
        teamScale: 'Skala Tim',
        organizationScale: 'Skala Organisasi',
        classification: 'Klasifikasi',
        confidential: 'Rahasia',
        highPriority: 'Prioritas Tinggi',
        orgProfile: 'Profil Organisasi',
        strategicBuilder: 'Pembangun Strategis',
        maturityLadder: 'Tangga Kematangan Organisasi',
        orgPrefix: 'Organisasi',
        nextEvolution: 'Evolusi Berikutnya',
        gapToNext: 'Gap ke Tahap Berikutnya',
        currentStage: 'Tahap Saat Ini',
        mainStrength: 'Kekuatan Utama',
        mainBottleneck: 'Hambatan Utama',
        strengthText: 'Dimensi terkuat berdasarkan distribusi skor assessment.',
        bottleneckText: 'Area prioritas yang paling menentukan akselerasi berikutnya.',
        executiveSummary: 'Ringkasan Eksekutif & Analisis Strategis',
        mapTitle: 'Peta Intelijen Diagnostik',
        mapSectionTitle: 'Peta Kinerja & Analisis 7 Dimensi Organisasi',
        mapSectionSubtitle: 'Visualisasi distribusi skor dan perbandingan efisiensi operasional',
        balanceDistribution: 'Distribusi Keseimbangan',
        scoreBoard: 'Papan Skor Performa',
        diagnosticReasoning: 'Penalaran Diagnostik',
        riskProjection: 'Proyeksi Risiko 12-18 Bulan',
        strategicOverview: 'Ikhtisar Strategis Diagnostik',
        strategicOverviewSubtitle: 'Prioritas utama Â· fokus aksi 90 hari',
        priorityActions: 'Rekomendasi Tindakan Prioritas',
        priorityActionsSubtitle: 'Tiga prioritas awal berdasarkan hasil diagnostik 7 dimensi BinaHub',
        strategy: 'STRATEGI',
        consultantKey: 'Kunci Strategis dari Tim Konsultan',
        roadmapTitle: 'Roadmap Transformasi',
        roadmapSubtitle: 'Roadmap lanjutan Â· langkah konsultasi berikutnya',
        roadmapSection: 'Roadmap Lanjutan & Langkah Berikutnya',
        roadmapSectionSubtitle: 'Rekomendasi pendukung untuk memperkuat ritme implementasi setelah prioritas utama berjalan',
        nextSteps: 'Langkah Berikutnya',
        nextStepsText: 'Diskusikan hasil ini bersama tim BinaHub untuk menerjemahkan prioritas diagnostik menjadi roadmap implementasi yang relevan dengan konteks organisasi Anda.',
        footer: 'Â© 2025 BinaHub Â· Divisi Transformasi Strategis Â· Dokumen Rahasia',
        page: 'Halaman',
        of: 'dari',
        reportHeaderLabel: 'Laporan Diagnostik Performa',
        reportHeaderTitle: 'Human Synergy &',
        reportHeaderSubtitle: 'Diagnostik Kematangan Strategis',
        maturityLevels: MATURITY_LEVELS,
      }
}

function getMaturityLevel(score: number, levels = MATURITY_LEVELS) {
  return levels.find((level) => score >= level.min && score <= level.max) || levels[0];
}

function getNextMaturityLevel(score: number, levels = MATURITY_LEVELS) {
  return levels.find((level) => score < level.min) || null;
}

const styles = StyleSheet.create({
  page: { backgroundColor: ICE, color: '#1A2332', fontFamily: 'Inter', padding: 0 },
  header: { position: 'relative', backgroundColor: '#FFFFFF', height: 185, padding: '30 44', color: '#1A2332' },
  compactHeader: { position: 'relative', backgroundColor: '#FFFFFF', height: 70, padding: '15 44', color: '#1A2332' },
  headerAccent: { position: 'absolute', bottom: -6, left: 0, right: 0, height: 6, backgroundColor: GOLD },
  headerMotif: { position: 'absolute', top: -30, right: -40, opacity: 0.1 },
  logoBox: { width: 100, height: 28, marginBottom: 15 },
  logoImage: { width: '100%', height: '100%', objectFit: 'contain' },
  headerTitleBlock: { marginTop: 8 },
  headerLabel: { color: GOLD, fontSize: 8, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase', marginBottom: 6 },
  headerTitle: { fontSize: 22, fontWeight: 700, lineHeight: 1 },
  headerSubtitle: { fontSize: 22, fontWeight: 700, color: NAVY, marginTop: 8 },
  metaRow: { flexDirection: 'row', marginTop: 25, gap: 40 },
  metaItem: { flexDirection: 'column' },
  metaLabel: { fontSize: 6.5, color: '#64748B', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  metaValue: { fontSize: 8, color: NAVY, fontWeight: 600 },
  content: { padding: '22 44 72 44' },
  kpiRow: { flexDirection: 'row', padding: '0 44', marginTop: 10, gap: 12, zIndex: 10 },
  kpiCard: { flex: 1, backgroundColor: '#FFFFFF', padding: 15, borderRadius: 8, borderTopWidth: 4, borderTopColor: GOLD, shadowColor: '#000', shadowOpacity: 0.05, shadowOffset: { width: 0, height: 4 } },
  kpiLabel: { fontSize: 7, color: '#64748B', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 },
  kpiValue: { fontSize: 18, fontWeight: 700, color: NAVY },
  kpiBadge: { marginTop: 8, padding: '3 8', backgroundColor: '#F1F5F9', borderRadius: 4, alignSelf: 'flex-start' },
  kpiBadgeText: { fontSize: 8, color: NAVY, fontWeight: 700 },
  sectionHeader: { marginBottom: 18, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  sectionBar: { width: 4, height: 30, backgroundColor: NAVY },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#1A2332' },
  sectionSubtitle: { fontSize: 8, color: '#64748B', marginTop: 2 },
  profileCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 18, marginBottom: 18, borderLeftWidth: 4, borderLeftColor: GOLD },
  profileLabel: { fontSize: 7, color: SILVER, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 6 },
  profileTitle: { fontSize: 16, color: NAVY, fontWeight: 700, marginBottom: 7 },
  profileText: { fontSize: 9.2, color: '#4A5568', lineHeight: 1.55 },
  maturityCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 18, marginBottom: 18, borderTopWidth: 4, borderTopColor: NAVY },
  maturityHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  maturityLabel: { fontSize: 7, color: SILVER, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 5 },
  maturityCurrent: { fontSize: 16, color: NAVY, fontWeight: 700 },
  maturityNext: { fontSize: 9, color: '#4A5568', lineHeight: 1.4, textAlign: 'right' },
  maturityTrack: { flexDirection: 'row', gap: 6 },
  maturityStep: { flex: 1, borderRadius: 6, padding: '8 6', backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  maturityStepActive: { backgroundColor: NAVY, borderColor: NAVY },
  maturityStepText: { fontSize: 7, color: '#64748B', fontWeight: 700, textAlign: 'center' },
  maturityStepTextActive: { color: '#FFFFFF' },
  twoColumn: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  miniCard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 8, padding: 16, borderTopWidth: 4 },
  miniLabel: { fontSize: 7, color: SILVER, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  miniTitle: { fontSize: 13, color: NAVY, fontWeight: 700, marginBottom: 6 },
  miniText: { fontSize: 8.5, color: '#4A5568', lineHeight: 1.5 },
  summaryCard: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 24, borderLeftWidth: 4, borderLeftColor: GOLD },
  summaryTitle: { fontSize: 10, fontWeight: 700, color: NAVY, textTransform: 'uppercase', marginBottom: 10 },
  summaryText: { fontSize: 10, lineHeight: 1.55, color: '#4A5568', fontWeight: 400 },
  visualGrid: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  visualBox: { flex: 1, backgroundColor: '#FFFFFF', padding: 16, borderRadius: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  visualTitle: { fontSize: 8, fontWeight: 700, color: NAVY, textTransform: 'uppercase', marginBottom: 15, textAlign: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 9, width: '100%' },
  barLabel: { width: 60, fontSize: 8, color: '#4A5568', fontWeight: 600 },
  barTrack: { flex: 1, height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden', marginHorizontal: 8 },
  barFill: { height: '100%', backgroundColor: NAVY, borderRadius: 3 },
  barValue: { width: 25, fontSize: 8, color: NAVY, fontWeight: 700, textAlign: 'right' },
  recGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  recCard: { width: '31.5%', backgroundColor: '#FFFFFF', padding: 14, borderRadius: 8, borderTopWidth: 3, borderTopColor: GOLD },
  recIcon: { width: 14, height: 14, backgroundColor: NAVY, borderRadius: 7, marginBottom: 10, justifyContent: 'center', alignItems: 'center' },
  recIconInner: { width: 6, height: 6, backgroundColor: GOLD, borderRadius: 3 },
  recTitle: { fontSize: 9, fontWeight: 700, color: NAVY, marginBottom: 7, lineHeight: 1.3 },
  recDiagnosis: { fontSize: 7.4, color: NAVY, lineHeight: 1.38, marginBottom: 6 },
  recDesc: { fontSize: 8.2, color: '#64748B', lineHeight: 1.45 },
  callout: { marginTop: 24, backgroundColor: '#E2E8F0', padding: 18, borderRadius: 8, borderTopWidth: 4, borderTopColor: NAVY },
  riskCard: { marginTop: 16, backgroundColor: '#FFFFFF', padding: 18, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: GOLD },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 44, backgroundColor: NAVY, borderTopWidth: 2, borderTopColor: GOLD, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '0 44' },
  footerText: { fontSize: 7.5, color: SILVER },
  footerPage: { fontSize: 8, color: '#FFFFFF', fontWeight: 600 },
});

function CompactHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.compactHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: '#FFFFFF', fontWeight: 800 }}>B</Text>
        </View>
        <View>
          <Text style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{title}</Text>
          <Text style={{ fontSize: 7, color: '#64748B' }}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.headerAccent} />
    </View>
  );
}

function Footer({ page, copy }: { page: number; copy: ReturnType<typeof getPdfCopy> }) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{copy.footer}</Text>
      <Text style={styles.footerPage}>{copy.page} {page} {copy.of} 4</Text>
    </View>
  );
}

function compactText(text = '', maxLength = 280) {
  if (text.length <= maxLength) return text;
  const trimmed = text.slice(0, maxLength).trim();
  const lastSpace = trimmed.lastIndexOf(' ');
  return `${trimmed.slice(0, lastSpace > 180 ? lastSpace : maxLength).trim()}...`;
}

const AssessmentPDF = ({ formData, result, logoPath, locale = 'id' }: { formData: AssessmentData; result: AssessmentResult; logoPath?: string; locale?: Locale }) => {
  const copy = getPdfCopy(locale);
  const scores = result.scores;
  const sortedDimensions = [...DIMENSIONS].sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const topDimension = sortedDimensions[0];
  const lowestDimension = sortedDimensions[sortedDimensions.length - 1];
  const angleStep = (2 * Math.PI) / 7;
  const radarPoints = DIMENSIONS.map((dim, i) => {
    const score = scores[dim] || 0;
    const r = 45 * (score / 100);
    const angle = i * angleStep - Math.PI / 2;
    return { x: 65 + r * Math.cos(angle), y: 65 + r * Math.sin(angle) };
  }).map((p) => `${p.x},${p.y}`).join(' ');

  const date = new Date().toLocaleDateString(copy.localeDate, { day: 'numeric', month: 'long', year: 'numeric' });
  const logoSrc = logoPath || 'https://buhanib.vercel.app/full-logo.png';
  const maturityLevel = getMaturityLevel(scores.overall, copy.maturityLevels);
  const nextMaturityLevel = getNextMaturityLevel(scores.overall, copy.maturityLevels);
  const gapToNext = nextMaturityLevel ? Math.max(0, nextMaturityLevel.min - scores.overall) : 0;
  const scoreInterpretation = result.scoreInterpretation || (locale === 'en'
    ? `A score of ${scores.overall} places ${formData.company} in the ${result.category} category, with relative strength in ${topDimension} and a strengthening priority in ${lowestDimension}.`
    : `Skor ${scores.overall} menempatkan ${formData.company} pada kategori ${result.category}, dengan kekuatan relatif pada ${topDimension} dan prioritas penguatan pada ${lowestDimension}.`);
  const strategicKey = result.strategicKey || (locale === 'en'
    ? `Over the next 90 days, the main focus is strengthening ${lowestDimension} so organizational capability is better connected to daily execution rhythm.`
    : `Dalam 90 hari ke depan, fokus utama adalah memperkuat dimensi ${lowestDimension} agar kapasitas organisasi lebih terhubung dengan ritme eksekusi harian.`);
  const riskProjection = result.riskProjection || (locale === 'en'
    ? `If ${lowestDimension} is not strengthened, the organization risks slower execution as growth demands increase.`
    : `Jika dimensi ${lowestDimension} tidak diperkuat, organisasi berisiko mengalami perlambatan eksekusi saat tuntutan pertumbuhan meningkat.`);
  const primaryRecommendations = result.recommendations.slice(0, 3);
  const secondaryRecommendations = result.recommendations.slice(3);
  const crossInsights = result.crossDimensionalInsights?.length ? result.crossDimensionalInsights : [
    locale === 'en'
      ? `${topDimension} is a relative strength, while ${lowestDimension} is the priority area to address.`
      : `Dimensi ${topDimension} menjadi kekuatan relatif, sementara ${lowestDimension} menjadi area prioritas yang perlu ditangani.`,
    locale === 'en'
      ? `The gap across dimensions shows the need to connect strategic potential with more consistent implementation discipline.`
      : `Perbedaan skor antardimensi menunjukkan perlunya menghubungkan potensi strategis dengan disiplin implementasi yang lebih konsisten.`,
  ];

  return (
    <Document title={`${copy.documentTitle} - ${formData.company}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Svg style={styles.headerMotif} width="200" height="200">
            <Circle cx="150" cy="50" r="100" fill={NAVY} fillOpacity="0.03" />
            <Circle cx="170" cy="70" r="70" fill={NAVY} fillOpacity="0.03" />
          </Svg>
          <View style={styles.logoBox}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={logoSrc} style={styles.logoImage} />
          </View>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerLabel}>{copy.reportHeaderLabel}</Text>
            <Text style={styles.headerTitle}>{copy.reportHeaderTitle}</Text>
            <Text style={styles.headerSubtitle}>{copy.reportHeaderSubtitle}</Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>{copy.fiscalYear}</Text><Text style={styles.metaValue}>2024-2025</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>{copy.preparedFor}</Text><Text style={styles.metaValue}>{formData.name.toUpperCase()}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>{copy.company}</Text><Text style={styles.metaValue}>{formData.company.toUpperCase()}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>{copy.issueDate}</Text><Text style={styles.metaValue}>{date.toUpperCase()}</Text></View>
          </View>
          <View style={styles.headerAccent} />
        </View>

        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{copy.overallScore}</Text>
            <Text style={styles.kpiValue}>{scores.overall}</Text>
            <View style={styles.kpiBadge}><Text style={styles.kpiBadgeText}>{copy.stage}: {result.category}</Text></View>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{copy.totalDimensions}</Text>
            <Text style={styles.kpiValue}>7</Text>
            <View style={styles.kpiBadge}><Text style={styles.kpiBadgeText}>{copy.coreCriteria}</Text></View>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{copy.teamScale}</Text>
            <Text style={styles.kpiValue}>{formData.employees || '-'}</Text>
            <View style={styles.kpiBadge}><Text style={styles.kpiBadgeText}>{copy.organizationScale}</Text></View>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{copy.classification}</Text>
            <Text style={[styles.kpiValue, { fontSize: 14, marginTop: 4 }]}>{copy.confidential}</Text>
            <View style={styles.kpiBadge}><Text style={styles.kpiBadgeText}>{copy.highPriority}</Text></View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.profileCard} wrap={false}>
            <Text style={styles.profileLabel}>{copy.orgProfile}</Text>
            <Text style={styles.profileTitle}>{result.archetype || copy.strategicBuilder}</Text>
            <Text style={styles.profileText}>{scoreInterpretation}</Text>
          </View>

          <View style={styles.maturityCard} wrap={false}>
            <View style={styles.maturityHeader}>
              <View>
                <Text style={styles.maturityLabel}>{copy.maturityLadder}</Text>
                <Text style={styles.maturityCurrent}>{copy.orgPrefix} {maturityLevel.label}</Text>
              </View>
              <Text style={styles.maturityNext}>
                {nextMaturityLevel ? `${copy.nextEvolution}: ${nextMaturityLevel.label}\n${copy.gapToNext}: +${gapToNext}` : `${copy.currentStage}: ${maturityLevel.label}\n${copy.gapToNext}: -`}
              </Text>
            </View>
            <View style={styles.maturityTrack}>
              {MATURITY_LEVELS.map((level) => {
                const isActive = level.label === maturityLevel.label;
                return (
                  <View key={level.label} style={[styles.maturityStep, isActive ? styles.maturityStepActive : {}]}>
                    <Text style={[styles.maturityStepText, isActive ? styles.maturityStepTextActive : {}]}>{level.label}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.twoColumn} wrap={false}>
            <View style={[styles.miniCard, { borderTopColor: NAVY }]}>
              <Text style={styles.miniLabel}>{copy.mainStrength}</Text>
              <Text style={styles.miniTitle}>{topDimension}</Text>
              <Text style={styles.miniText}>{copy.strengthText}</Text>
            </View>
            <View style={[styles.miniCard, { borderTopColor: GOLD }]}>
              <Text style={styles.miniLabel}>{copy.mainBottleneck}</Text>
              <Text style={styles.miniTitle}>{lowestDimension}</Text>
              <Text style={styles.miniText}>{copy.bottleneckText}</Text>
            </View>
          </View>

          <View style={styles.summaryCard} wrap={false}>
            <Text style={styles.summaryTitle}>{copy.executiveSummary}</Text>
              <Text style={styles.summaryText}>{compactText(result.aiAnalysis, 620)}</Text>
          </View>
        </View>
        <Footer page={1} copy={copy} />
      </Page>

      <Page size="A4" style={styles.page}>
        <CompactHeader title={copy.mapTitle} subtitle={copy.compactSubtitle} />
        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionBar} />
            <View>
              <Text style={styles.sectionTitle}>{copy.mapSectionTitle}</Text>
              <Text style={styles.sectionSubtitle}>{copy.mapSectionSubtitle}</Text>
            </View>
          </View>

          <View style={styles.visualGrid} wrap={false}>
            <View style={styles.visualBox}>
              <Text style={styles.visualTitle}>{copy.balanceDistribution}</Text>
              <Svg width="150" height="150" viewBox="0 0 130 130" style={{ alignSelf: 'center' }}>
                {[0.25, 0.5, 0.75, 1].map((scale, idx) => {
                  const pts = DIMENSIONS.map((_, i) => {
                    const r = 45 * scale;
                    const angle = i * angleStep - Math.PI / 2;
                    return `${65 + r * Math.cos(angle)},${65 + r * Math.sin(angle)}`;
                  }).join(' ');
                  return <Polygon key={idx} points={pts} fill="none" stroke="#E2E8F0" strokeWidth="0.5" />;
                })}
                <Polygon points={radarPoints} fill="rgba(212, 175, 55, 0.15)" stroke={GOLD} strokeWidth="2" />
              </Svg>
              <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                {DIMENSIONS.map((d) => <Text key={d} style={{ fontSize: 6, color: SILVER }}>{d.toUpperCase()}: {scores[d]}</Text>)}
              </View>
            </View>

            <View style={[styles.visualBox, { flex: 1.4 }]}>
              <Text style={styles.visualTitle}>{copy.scoreBoard}</Text>
              {DIMENSIONS.map((dim) => (
                <View key={dim} style={styles.barRow}>
                  <Text style={styles.barLabel}>{dim}</Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${scores[dim] || 0}%`, backgroundColor: (scores[dim] || 0) >= 80 ? GOLD : NAVY }]} />
                  </View>
                  <Text style={styles.barValue}>{scores[dim]}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.twoColumn}>
            {crossInsights.slice(0, 2).map((insight, i) => (
              <View key={i} wrap={false} style={[styles.miniCard, { borderTopColor: i === 0 ? NAVY : GOLD }]}>
                <Text style={styles.miniLabel}>{copy.diagnosticReasoning} 0{i + 1}</Text>
                <Text style={styles.miniText}>{compactText(insight, 330)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.riskCard} wrap={false}>
            <Text style={styles.summaryTitle}>{copy.riskProjection}</Text>
            <Text style={styles.summaryText}>{compactText(riskProjection, 520)}</Text>
          </View>
        </View>
        <Footer page={2} copy={copy} />
      </Page>

      <Page size="A4" style={styles.page}>
        <CompactHeader title={copy.strategicOverview} subtitle={copy.strategicOverviewSubtitle} />
        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionBar} />
            <View>
              <Text style={styles.sectionTitle}>{copy.priorityActions}</Text>
              <Text style={styles.sectionSubtitle}>{copy.priorityActionsSubtitle}</Text>
            </View>
          </View>

          <View style={styles.recGrid}>
            {primaryRecommendations.map((rec, i) => (
              <View key={i} wrap={false} style={styles.recCard}>
                <View style={styles.recIcon}><View style={styles.recIconInner} /></View>
                <Text style={{ fontSize: 7, color: SILVER, fontWeight: 700, marginBottom: 4 }}>{copy.strategy} 0{i + 1} · {rec.service}</Text>
                <Text style={styles.recTitle}>{compactText(rec.title, 86)}</Text>
                {rec.diagnosis && <Text style={styles.recDiagnosis}>{compactText(rec.diagnosis, 180)}</Text>}
                <Text style={styles.recDesc}>{compactText(rec.description, 260)}</Text>
              </View>
            ))}
          </View>

          <View style={styles.callout} wrap={false}>
            <Text style={styles.summaryTitle}>{copy.consultantKey}</Text>
            <Text style={styles.summaryText}>{compactText(strategicKey, 560)}</Text>
          </View>
        </View>
        <Footer page={3} copy={copy} />
      </Page>

      <Page size="A4" style={styles.page}>
        <CompactHeader title={copy.roadmapTitle} subtitle={copy.roadmapSubtitle} />
        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionBar} />
            <View>
              <Text style={styles.sectionTitle}>{copy.roadmapSection}</Text>
              <Text style={styles.sectionSubtitle}>{copy.roadmapSectionSubtitle}</Text>
            </View>
          </View>

          <View style={styles.recGrid}>
            {secondaryRecommendations.map((rec, i) => (
              <View key={i} wrap={false} style={[styles.recCard, { width: '48.5%' }]}>
                <View style={styles.recIcon}><View style={styles.recIconInner} /></View>
                <Text style={{ fontSize: 7, color: SILVER, fontWeight: 700, marginBottom: 4 }}>{copy.strategy} 0{i + 4} · {rec.service}</Text>
                <Text style={styles.recTitle}>{compactText(rec.title, 96)}</Text>
                {rec.diagnosis && <Text style={styles.recDiagnosis}>{compactText(rec.diagnosis, 220)}</Text>}
                <Text style={styles.recDesc}>{compactText(rec.description, 320)}</Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 22, backgroundColor: '#FFFFFF', padding: 18, borderRadius: 8, borderLeftWidth: 4, borderLeftColor: GOLD }} wrap={false}>
            <Text style={styles.summaryTitle}>{copy.nextSteps}</Text>
            <Text style={styles.summaryText}>
              {copy.nextStepsText}
            </Text>
          </View>
        </View>
        <Footer page={4} copy={copy} />
      </Page>
    </Document>
  );
};

const ProposalPDF = ({ formData, proposal, logoPath }: { formData: AssessmentData; proposal: ProposalResult; logoPath?: string }) => {
  const copy = getPdfCopy('id');
  const date = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const logoSrc = logoPath || 'https://buhanib.vercel.app/full-logo.png';
  const packages = proposal.packages?.length ? proposal.packages.slice(0, 3) : [
    {
      name: 'Paket A - Essential',
      price: 'Menyesuaikan ruang lingkup',
      bestFor: 'Organisasi yang membutuhkan intervensi awal dan prioritas cepat.',
      duration: '2-4 minggu',
      scope: proposal.scope || ['Review hasil assessment', 'Workshop prioritas', 'Roadmap awal'],
      deliverables: ['Executive brief', 'Priority map', 'Rencana aksi awal'],
    },
  ];

  return (
    <Document title={`Proposal Penawaran - ${formData.company}`}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Svg style={styles.headerMotif} width="200" height="200">
            <Circle cx="150" cy="50" r="100" fill={NAVY} fillOpacity="0.03" />
            <Circle cx="170" cy="70" r="70" fill={NAVY} fillOpacity="0.03" />
          </Svg>
          <View style={styles.logoBox}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={logoSrc} style={styles.logoImage} />
          </View>
          <View style={styles.headerTitleBlock}>
            <Text style={styles.headerLabel}>Proposal Penawaran Strategis</Text>
            <Text style={styles.headerTitle}>{proposal.proposedProgram || 'Program Transformasi Organisasi'}</Text>
            <Text style={styles.headerSubtitle}>{formData.company}</Text>
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>DISUSUN UNTUK</Text><Text style={styles.metaValue}>{formData.name.toUpperCase()}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>PERUSAHAAN</Text><Text style={styles.metaValue}>{formData.company.toUpperCase()}</Text></View>
            <View style={styles.metaItem}><Text style={styles.metaLabel}>TANGGAL</Text><Text style={styles.metaValue}>{date.toUpperCase()}</Text></View>
          </View>
          <View style={styles.headerAccent} />
        </View>

        <View style={styles.content}>
          <View style={styles.profileCard} wrap={false}>
            <Text style={styles.profileLabel}>Pendahuluan</Text>
            <Text style={styles.profileTitle}>Arah Penawaran Awal</Text>
            <Text style={styles.profileText}>{proposal.opening || 'Proposal ini disusun sebagai tindak lanjut awal berdasarkan hasil diagnostik organisasi Anda.'}</Text>
          </View>

          <View style={styles.twoColumn} wrap={false}>
            <View style={[styles.miniCard, { borderTopColor: NAVY }]}>
              <Text style={styles.miniLabel}>Timeline</Text>
              <Text style={styles.miniTitle}>{proposal.timeline || 'Menyesuaikan kebutuhan'}</Text>
              <Text style={styles.miniText}>Estimasi durasi akan difinalisasi setelah scope dan prioritas disepakati bersama.</Text>
            </View>
            <View style={[styles.miniCard, { borderTopColor: GOLD }]}>
              <Text style={styles.miniLabel}>Catatan Investasi</Text>
              <Text style={styles.miniText}>{proposal.investmentNote || 'Nilai investasi final bergantung pada skala, jumlah peserta, format program, dan keluaran yang dipilih.'}</Text>
            </View>
          </View>

          <View style={styles.summaryCard} wrap={false}>
            <Text style={styles.summaryTitle}>Ruang Lingkup Rekomendasi</Text>
            {(proposal.scope || []).slice(0, 6).map((item, index) => (
              <Text key={index} style={styles.summaryText}>â€¢ {item}</Text>
            ))}
          </View>
        </View>
        <Footer page={1} copy={copy} />
      </Page>

      <Page size="A4" style={styles.page}>
        <CompactHeader title="Pilihan Paket Penawaran" subtitle="Paket A, B, dan C berdasarkan tingkat kedalaman program" />
        <View style={styles.content}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionBar} />
            <View>
              <Text style={styles.sectionTitle}>Opsi Paket Implementasi</Text>
              <Text style={styles.sectionSubtitle}>Harga bersifat estimasi awal dan dapat disesuaikan setelah konsultasi lanjutan</Text>
            </View>
          </View>

          <View style={styles.recGrid}>
            {packages.map((pack, index) => (
              <View key={pack.name} wrap={false} style={[styles.recCard, { width: '31.5%', borderTopColor: index === 1 ? NAVY : GOLD }]}>
                <Text style={{ fontSize: 7, color: SILVER, fontWeight: 700, marginBottom: 6 }}>PAKET {String.fromCharCode(65 + index)}</Text>
                <Text style={styles.recTitle}>{pack.name}</Text>
                <Text style={[styles.kpiValue, { fontSize: 13, marginBottom: 8 }]}>{pack.price}</Text>
                <Text style={styles.recDiagnosis}>{pack.bestFor}</Text>
                <Text style={styles.miniLabel}>Durasi</Text>
                <Text style={styles.recDesc}>{pack.duration}</Text>
                <Text style={[styles.miniLabel, { marginTop: 8 }]}>Cakupan</Text>
                {pack.scope.slice(0, 5).map((item, itemIndex) => (
                  <Text key={itemIndex} style={styles.recDesc}>â€¢ {item}</Text>
                ))}
                <Text style={[styles.miniLabel, { marginTop: 8 }]}>Output</Text>
                {pack.deliverables.slice(0, 5).map((item, itemIndex) => (
                  <Text key={itemIndex} style={styles.recDesc}>â€¢ {item}</Text>
                ))}
              </View>
            ))}
          </View>

          <View style={styles.callout} wrap={false}>
            <Text style={styles.summaryTitle}>{copy.nextSteps}</Text>
            <Text style={styles.summaryText}>{proposal.nextStep || 'Jadwalkan konsultasi untuk memfinalisasi kebutuhan, ruang lingkup, peserta, timeline, dan opsi paket yang paling sesuai.'}</Text>
          </View>
        </View>
        <Footer page={2} copy={copy} />
      </Page>
    </Document>
  );
};

async function getLogoBase64() {
  let logoBase64 = 'https://buhanib.vercel.app/full-logo.png';
  try {
    const fs = await import('fs');
    const path = await import('path');
    const logoPath = path.join(process.cwd(), 'public', 'full-logo.png');
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PDF Service] Failed to read logo file locally, using URL fallback:', message);
  }
  return logoBase64;
}

export async function generatePDFBuffer(formData: AssessmentData, result: AssessmentResult, locale: Locale = 'id'): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');

  const logoBase64 = await getLogoBase64();

  return await renderToBuffer(<AssessmentPDF formData={formData} result={result} logoPath={logoBase64} locale={locale} />);
}

export async function generateProposalPDFBuffer(formData: AssessmentData, proposal: ProposalResult): Promise<Buffer> {
  const { renderToBuffer } = await import('@react-pdf/renderer');
  const logoBase64 = await getLogoBase64();

  return await renderToBuffer(<ProposalPDF formData={formData} proposal={proposal} logoPath={logoBase64} />);
}


