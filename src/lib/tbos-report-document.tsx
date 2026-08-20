import {
  Circle,
  Document,
  Line,
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
} from "@react-pdf/renderer";
import type {
  TbosDimensionResult,
  TbosProgramReport,
  TbosTeamReport,
} from "@/lib/tbos-report-data";

const NAVY = "#071B3D";
const BLUE = "#0B2C6B";
const GOLD = "#D9A441";
const PAPER = "#F7F8FB";
const SLATE = "#475569";
const BORDER = "#DCE3EC";

const styles = StyleSheet.create({
  page: { paddingTop: 34, paddingHorizontal: 34, paddingBottom: 34, fontSize: 9, color: "#1E293B", backgroundColor: "#FFFFFF", fontFamily: "Helvetica" },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: GOLD, paddingBottom: 9, marginBottom: 15 },
  brand: { fontSize: 17, fontWeight: 700, color: BLUE },
  brandAccent: { color: GOLD },
  eyebrow: { fontSize: 7, fontWeight: 700, color: GOLD, letterSpacing: 1.2, textTransform: "uppercase" },
  pageTitle: { marginTop: 3, fontSize: 15, fontWeight: 700, color: NAVY },
  meta: { marginTop: 3, fontSize: 7.5, color: "#64748B" },
  footer: { position: "absolute", bottom: 14, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.7, borderTopColor: BORDER, paddingTop: 5, fontSize: 6.5, color: "#64748B" },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, color: NAVY, marginBottom: 6 },
  sectionDescription: { marginTop: -3, marginBottom: 8, fontSize: 7.5, color: "#64748B", lineHeight: 1.4 },
  metrics: { flexDirection: "row", gap: 7, marginBottom: 15 },
  metric: { flex: 1, borderWidth: 0.8, borderColor: BORDER, borderRadius: 7, backgroundColor: PAPER, padding: 9 },
  metricLabel: { fontSize: 6.5, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5 },
  metricValue: { marginTop: 3, fontSize: 15, fontWeight: 700, color: BLUE },
  twoColumns: { flexDirection: "row", gap: 10 },
  column: { flex: 1 },
  callout: { borderRadius: 7, padding: 10, backgroundColor: "#F0F7FF", borderWidth: 0.8, borderColor: "#CFE0F7" },
  calloutTitle: { fontSize: 8, fontWeight: 700, color: BLUE, marginBottom: 4 },
  calloutText: { fontSize: 8, color: SLATE, lineHeight: 1.45 },
  listCard: { borderRadius: 7, padding: 9, borderWidth: 0.8, borderColor: BORDER },
  listRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  listIndex: { width: 15, height: 15, borderRadius: 8, backgroundColor: NAVY, color: "#FFFFFF", textAlign: "center", paddingTop: 3, fontSize: 7, fontWeight: 700 },
  listText: { flex: 1, fontSize: 7.5, color: SLATE },
  listScore: { width: 28, textAlign: "right", fontSize: 8, fontWeight: 700, color: BLUE },
  barRow: { marginBottom: 7 },
  barHeader: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 3 },
  barLabel: { flex: 1, fontSize: 7.2, fontWeight: 600, color: "#334155" },
  barScore: { width: 30, textAlign: "right", fontSize: 7.5, fontWeight: 700, color: BLUE },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: "#E8EDF3", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  table: { borderWidth: 0.8, borderColor: BORDER, borderRadius: 6, overflow: "hidden" },
  tableHeader: { flexDirection: "row", alignItems: "center", minHeight: 24, paddingHorizontal: 6, backgroundColor: NAVY },
  tableHeaderText: { fontSize: 6.5, fontWeight: 700, color: "#FFFFFF", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", alignItems: "center", minHeight: 25, paddingHorizontal: 6, borderTopWidth: 0.6, borderTopColor: BORDER },
  tableRowAlt: { backgroundColor: PAPER },
  tableCell: { fontSize: 7, color: "#334155" },
  radarGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  radarCard: { width: "48.7%", borderWidth: 0.8, borderColor: BORDER, borderRadius: 7, padding: 8, backgroundColor: "#FFFFFF" },
  radarTitle: { fontSize: 8.5, fontWeight: 700, color: NAVY },
  radarMeta: { marginTop: 2, fontSize: 6.5, color: "#64748B" },
  radarBody: { flexDirection: "row", alignItems: "center", gap: 4 },
  radarLegend: { flex: 1 },
  radarLegendRow: { flexDirection: "row", justifyContent: "space-between", gap: 4, marginBottom: 2 },
  radarLegendLabel: { flex: 1, fontSize: 5.6, color: SLATE },
  radarLegendScore: { fontSize: 5.8, fontWeight: 700, color: BLUE },
  heatmapHeader: { flexDirection: "row", minHeight: 34, alignItems: "flex-end", paddingVertical: 5, backgroundColor: NAVY },
  heatmapRow: { flexDirection: "row", minHeight: 24, alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: BORDER },
  heatmapTeam: { width: 92, paddingHorizontal: 5, fontSize: 6.4, fontWeight: 700, color: NAVY },
  heatmapBatch: { width: 44, paddingHorizontal: 3, fontSize: 6, color: SLATE },
  heatmapCell: { width: 45, height: 18, marginHorizontal: 1.5, borderRadius: 3, alignItems: "center", justifyContent: "center" },
  heatmapCellText: { fontSize: 6, fontWeight: 700 },
  batchCard: { marginBottom: 9, borderWidth: 0.8, borderColor: BORDER, borderRadius: 7, padding: 9, backgroundColor: PAPER },
  batchHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 7 },
  batchName: { fontSize: 9, fontWeight: 700, color: NAVY },
  batchScore: { fontSize: 9, fontWeight: 700, color: GOLD },
  teamHero: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderRadius: 9, padding: 12, backgroundColor: NAVY, color: "#FFFFFF", marginBottom: 12 },
  teamName: { fontSize: 17, fontWeight: 700, color: "#FFFFFF" },
  teamMeta: { marginTop: 3, fontSize: 7.5, color: "#CBD5E1" },
  teamScore: { fontSize: 22, fontWeight: 700, color: "#F3CE7A", textAlign: "right" },
  teamScoreLabel: { marginTop: 2, fontSize: 6.5, color: "#CBD5E1", textAlign: "right", textTransform: "uppercase" },
  rosterBox: { borderWidth: 0.8, borderColor: BORDER, borderRadius: 7, padding: 9, backgroundColor: PAPER },
  memberRow: { flexDirection: "row", justifyContent: "space-between", gap: 6, paddingVertical: 3, borderBottomWidth: 0.4, borderBottomColor: BORDER },
  memberName: { fontSize: 7.2, color: "#334155" },
  captain: { fontSize: 6.5, fontWeight: 700, color: "#9A6A12" },
  missionCard: { marginBottom: 6, borderWidth: 0.8, borderColor: BORDER, borderRadius: 6, padding: 7 },
  missionHeader: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  missionName: { flex: 1, fontSize: 7.5, fontWeight: 700, color: NAVY },
  missionScore: { width: 30, textAlign: "right", fontSize: 8, fontWeight: 700, color: BLUE },
  missionMeta: { marginTop: 3, fontSize: 6.5, color: "#64748B" },
  missionNote: { marginTop: 3, fontSize: 6.5, color: SLATE, fontStyle: "italic" },
});

function ReportHeader({ eyebrow, title, report, scopeLabel }: { eyebrow: string; title: string; report: TbosProgramReport; scopeLabel?: string }) {
  const meta = scopeLabel
    ? `${scopeLabel} | ${report.program.title} | ${report.program.code}`
    : `${report.program.title} | ${report.program.code}`;
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>Bina<Text style={styles.brandAccent}>Hub</Text></Text>
        <Text style={styles.meta}>Team Behavioral Observation System</Text>
      </View>
      <View style={{ maxWidth: 300, alignItems: "flex-end" }}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={[styles.pageTitle, { textAlign: "right" }]}>{title}</Text>
        <Text style={[styles.meta, { textAlign: "right" }]}>{meta}</Text>
      </View>
    </View>
  );
}

function PageFooter({ report }: { report: TbosProgramReport }) {
  return (
    <View style={styles.footer} fixed>
      <Text>BinaHub | T-BOS | Rahasia</Text>
      <Text render={({ pageNumber, totalPages }) => `Halaman ${pageNumber} dari ${totalPages}`} />
      <Text>{formatDate(report.generatedAt)}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function DimensionBars({ dimensions }: { dimensions: TbosDimensionResult[] }) {
  return (
    <View>
      {dimensions.map((dimension) => (
        <View key={dimension.code} style={styles.barRow}>
          <View style={styles.barHeader}>
            <Text style={styles.barLabel}>{dimension.name}</Text>
            <Text style={styles.barScore}>{formatScore(dimension.score)}</Text>
          </View>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${dimension.score === null ? 0 : Math.max(0, Math.min(100, dimension.score / 5 * 100))}%`, backgroundColor: dimension.color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function RankedDimensions({ dimensions, emptyText }: { dimensions: TbosDimensionResult[]; emptyText: string }) {
  if (dimensions.length === 0) return <Text style={styles.calloutText}>{emptyText}</Text>;
  return (
    <View>
      {dimensions.map((dimension, index) => (
        <View key={dimension.code} style={styles.listRow}>
          <Text style={styles.listIndex}>{index + 1}</Text>
          <Text style={styles.listText}>{dimension.name}</Text>
          <Text style={styles.listScore}>{formatScore(dimension.score)}</Text>
        </View>
      ))}
    </View>
  );
}

function TeamRadar({ dimensions }: { dimensions: TbosDimensionResult[] }) {
  const size = 112;
  const center = size / 2;
  const radius = 45;
  const values = dimensions.map((dimension) => dimension.score || 0);
  return (
    <Svg width={size} height={size}>
      {[1, 2, 3, 4, 5].map((level) => <Polygon key={level} points={radarPoints(dimensions.map(() => level), radius, center)} fill="none" stroke="#DCE3EC" strokeWidth={0.6} />)}
      {dimensions.map((dimension, index) => {
        const endpoint = pointAt(index, dimensions.length, radius, center);
        return <Line key={dimension.code} x1={center} y1={center} x2={endpoint.x} y2={endpoint.y} stroke="#DCE3EC" strokeWidth={0.6} />;
      })}
      <Polygon points={radarPoints(values, radius, center)} fill={GOLD} fillOpacity={0.28} stroke={BLUE} strokeWidth={1.3} />
      {values.map((value, index) => {
        const point = pointAt(index, values.length, radius * value / 5, center);
        return <Circle key={dimensions[index]?.code || index} cx={point.x} cy={point.y} r={1.6} fill={BLUE} />;
      })}
    </Svg>
  );
}

function TeamDetailPage({ report, team, scopeLabel }: { report: TbosProgramReport; team: TbosTeamReport; scopeLabel?: string }) {
  return (
    <Page size="A4" style={styles.page} wrap={false}>
      <ReportHeader eyebrow="Laporan per Tim" title={team.name} report={report} scopeLabel={scopeLabel} />
      <View style={styles.teamHero} wrap={false}>
        <View>
          <Text style={styles.teamName}>{team.name}</Text>
          <Text style={styles.teamMeta}>{team.batch} | {team.observations.length} observasi | {team.members.length} anggota</Text>
        </View>
        <View>
          <Text style={styles.teamScore}>{formatScore(team.overallScore)}</Text>
          <Text style={styles.teamScoreLabel}>Skor rata-rata / 5</Text>
        </View>
      </View>

      <View style={[styles.twoColumns, styles.section]}>
        <View style={styles.column}>
          <Text style={styles.sectionTitle}>Profil Tim</Text>
          <View style={styles.rosterBox}>
            <Text style={[styles.calloutTitle, { marginBottom: 5 }]}>Kapten: {team.captainName || "Belum ditentukan"}</Text>
            {team.members.length === 0 ? <Text style={styles.calloutText}>Daftar anggota belum diisi.</Text> : team.members.map((member, index) => (
              <View key={`${member.name}-${index}`} style={styles.memberRow}>
                <Text style={styles.memberName}>{member.name}</Text>
                <Text style={styles.captain}>{member.isCaptain ? "KAPTEN" : ""}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.column}>
          <Text style={styles.sectionTitle}>Ringkasan Perilaku</Text>
          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>Kekuatan utama</Text>
            <Text style={styles.calloutText}>{team.strongestDimension ? `${team.strongestDimension.name} (${formatScore(team.strongestDimension.score)})` : "Belum cukup data."}</Text>
            <Text style={[styles.calloutTitle, { marginTop: 8 }]}>Area pengembangan</Text>
            <Text style={styles.calloutText}>{team.developmentDimension ? `${team.developmentDimension.name} (${formatScore(team.developmentDimension.score)})` : "Belum cukup data."}</Text>
          </View>
        </View>
      </View>

      <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>Delapan Dimensi Perilaku</Text>
        <Text style={styles.sectionDescription}>Batang berwarna menunjukkan skor rata-rata pada skala 1-5. Tanda - berarti dimensi belum diobservasi.</Text>
        <DimensionBars dimensions={team.dimensions} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Hasil per Misi</Text>
        {team.missions.length === 0 ? <Text style={styles.calloutText}>Belum ada observasi yang tersimpan.</Text> : team.missions.map((mission) => (
          <View key={mission.code} style={styles.missionCard} wrap={false}>
            <View style={styles.missionHeader}><Text style={styles.missionName}>{mission.name}</Text><Text style={styles.missionScore}>{formatScore(mission.score)}</Text></View>
            <Text style={styles.missionMeta}>Fasilitator: {mission.facilitatorName} | Tanggal: {formatDate(mission.observedAt)}</Text>
            {mission.notes && <Text style={styles.missionNote}>Catatan: {mission.notes}</Text>}
          </View>
        ))}
      </View>
      <PageFooter report={report} />
    </Page>
  );
}

export function TbosGroupReportDocument({ report, batch }: { report: TbosProgramReport; batch?: string }) {
  // Ranking table stays score-ordered; every other section (radar, heatmap,
  // per-team detail pages) lists teams alphabetically for predictable lookup.
  const rankedTeams = [...report.teams].sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));
  const alphabeticalTeams = [...report.teams].sort((a, b) => a.name.localeCompare(b.name, "id-ID"));
  const scopeLabel = batch;
  const eyebrow = batch ? "Laporan per Batch" : "Laporan Grup";
  return (
    <Document title={`T-BOS - ${batch ? `Batch ${batch} - ` : ""}${report.program.title}`} author="BinaHub" subject="T-BOS Group Report">
      <Page size="A4" style={styles.page}>
        <ReportHeader eyebrow={eyebrow} title="Ringkasan Eksekutif" report={report} scopeLabel={scopeLabel} />
        <View style={styles.metrics}>
          <Metric label="Total tim" value={report.teams.length} />
          <Metric label="Total observasi" value={report.totalObservations} />
          <Metric label="Total batch" value={report.batches.length} />
          <Metric label="Skor rata-rata" value={formatScore(report.overallScore)} />
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gambaran Organisasi</Text>
          <View style={styles.callout}>
            <Text style={styles.calloutText}>{executiveNarrative(report)}</Text>
          </View>
        </View>
        <View style={[styles.twoColumns, styles.section]}>
          <View style={[styles.column, styles.listCard]}>
            <Text style={styles.sectionTitle}>Kekuatan Utama</Text>
            <RankedDimensions dimensions={report.strengths} emptyText="Belum cukup data." />
          </View>
          <View style={[styles.column, styles.listCard]}>
            <Text style={styles.sectionTitle}>Area Pengembangan</Text>
            <RankedDimensions dimensions={report.developmentAreas} emptyText="Belum cukup data." />
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rata-rata Delapan Dimensi</Text>
          <DimensionBars dimensions={report.dimensions} />
        </View>
        <PageFooter report={report} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <ReportHeader eyebrow="Ringkasan" title="Peringkat dan Skor Tim" report={report} scopeLabel={scopeLabel} />
        <Text style={styles.sectionDescription}>Peringkat memakai skor rata-rata misi yang telah diselesaikan. Misi yang belum diobservasi tidak dihitung sebagai nol.</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader} fixed>
            <Text style={[styles.tableHeaderText, { width: 25 }]}>No.</Text>
            <Text style={[styles.tableHeaderText, { flex: 1.2 }]}>Tim</Text>
            <Text style={[styles.tableHeaderText, { width: 65 }]}>Batch</Text>
            <Text style={[styles.tableHeaderText, { width: 44, textAlign: "center" }]}>Skor</Text>
            <Text style={[styles.tableHeaderText, { width: 44, textAlign: "center" }]}>Obs.</Text>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>Kekuatan</Text>
            <Text style={[styles.tableHeaderText, { flex: 1 }]}>Pengembangan</Text>
          </View>
          {rankedTeams.map((team, index) => (
            <View key={team.id} style={[styles.tableRow, ...(index % 2 ? [styles.tableRowAlt] : [])]} wrap={false}>
              <Text style={[styles.tableCell, { width: 25 }]}>{index + 1}</Text>
              <Text style={[styles.tableCell, { flex: 1.2, fontWeight: 700, color: NAVY }]}>{team.name}</Text>
              <Text style={[styles.tableCell, { width: 65 }]}>{team.batch}</Text>
              <Text style={[styles.tableCell, { width: 44, textAlign: "center", fontWeight: 700 }]}>{formatScore(team.overallScore)}</Text>
              <Text style={[styles.tableCell, { width: 44, textAlign: "center" }]}>{team.observations.length}</Text>
              <Text style={[styles.tableCell, { flex: 1 }]}>{team.strongestDimension?.name || "-"}</Text>
              <Text style={[styles.tableCell, { flex: 1 }]}>{team.developmentDimension?.name || "-"}</Text>
            </View>
          ))}
        </View>
        <PageFooter report={report} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <ReportHeader eyebrow="Grafik Radar" title="Profil Delapan Dimensi per Tim" report={report} scopeLabel={scopeLabel} />
        <Text style={styles.sectionDescription}>Setiap grafik menunjukkan pola skor tim pada delapan dimensi perilaku.</Text>
        <View style={styles.radarGrid}>
          {alphabeticalTeams.map((team) => (
            <View key={team.id} style={styles.radarCard} wrap={false}>
              <Text style={styles.radarTitle}>{team.name}</Text>
              <Text style={styles.radarMeta}>{team.batch} | Skor {formatScore(team.overallScore)}</Text>
              <View style={styles.radarBody}>
                <TeamRadar dimensions={team.dimensions} />
                <View style={styles.radarLegend}>{team.dimensions.map((dimension) => <View key={dimension.code} style={styles.radarLegendRow}><Text style={styles.radarLegendLabel}>{dimension.name}</Text><Text style={styles.radarLegendScore}>{formatScore(dimension.score)}</Text></View>)}</View>
              </View>
            </View>
          ))}
        </View>
        <PageFooter report={report} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <ReportHeader eyebrow="Heatmap" title="Perbandingan Delapan Dimensi" report={report} scopeLabel={scopeLabel} />
        <Text style={styles.sectionDescription}>Warna menunjukkan level skor: merah lebih rendah, kuning menengah, dan hijau lebih tinggi.</Text>
        <View style={{ borderWidth: 0.8, borderColor: BORDER }}>
          <View style={styles.heatmapHeader} fixed>
            <Text style={[styles.tableHeaderText, { width: 92, paddingHorizontal: 5 }]}>Tim</Text>
            <Text style={[styles.tableHeaderText, { width: 44, paddingHorizontal: 3 }]}>Batch</Text>
            {report.dimensions.map((dimension) => <Text key={dimension.code} style={[styles.tableHeaderText, { width: 45, textAlign: "center", fontSize: 5.5 }]}>{shortDimensionName(dimension.code)}</Text>)}
          </View>
          {alphabeticalTeams.map((team, index) => (
            <View key={team.id} style={[styles.heatmapRow, ...(index % 2 ? [styles.tableRowAlt] : [])]} wrap={false}>
              <Text style={styles.heatmapTeam}>{team.name}</Text><Text style={styles.heatmapBatch}>{team.batch}</Text>
              {team.dimensions.map((dimension) => {
                const tone = heatmapTone(dimension.score);
                return <View key={dimension.code} style={[styles.heatmapCell, { backgroundColor: tone.background }]}><Text style={[styles.heatmapCellText, { color: tone.text }]}>{formatScore(dimension.score)}</Text></View>;
              })}
            </View>
          ))}
        </View>
        <PageFooter report={report} />
      </Page>

      <Page size="A4" style={styles.page} wrap>
        <ReportHeader eyebrow="Perbandingan Batch" title="Rata-rata per Batch" report={report} scopeLabel={scopeLabel} />
        <Text style={styles.sectionDescription}>Perbandingan dihitung dari skor tim yang memiliki data pada dimensi terkait.</Text>
        {report.batches.length === 0 ? <Text style={styles.calloutText}>Belum ada data batch.</Text> : report.batches.map((batch) => (
          <View key={batch.batch} style={styles.batchCard} wrap={false}>
            <View style={styles.batchHeader}><Text style={styles.batchName}>{batch.batch}</Text><Text style={styles.batchScore}>Skor {formatScore(batch.overallScore)}</Text></View>
            <DimensionBars dimensions={batch.dimensions} />
          </View>
        ))}
        <PageFooter report={report} />
      </Page>

      {alphabeticalTeams.map((team) => <TeamDetailPage key={team.id} report={report} team={team} scopeLabel={scopeLabel} />)}
    </Document>
  );
}

export function TbosTeamReportDocument({ report, team }: { report: TbosProgramReport; team: TbosTeamReport }) {
  return <Document title={`T-BOS - ${team.name}`} author="BinaHub" subject="T-BOS Team Report"><TeamDetailPage report={report} team={team} /></Document>;
}

function executiveNarrative(report: TbosProgramReport) {
  if (report.totalObservations === 0) return `Belum ada observasi yang tersimpan untuk ${report.program.title}. Laporan akan terisi setelah fasilitator menyelesaikan penilaian.`;
  const strength = report.strengths[0];
  const development = report.developmentAreas[0];
  return `Berdasarkan ${report.totalObservations} observasi terhadap ${report.teams.length} tim, skor rata-rata program adalah ${formatScore(report.overallScore)} dari 5. Kekuatan utama berada pada ${strength?.name || "dimensi yang belum dapat ditentukan"} dengan skor ${formatScore(strength?.score ?? null)}. Prioritas pengembangan berada pada ${development?.name || "dimensi yang belum dapat ditentukan"} dengan skor ${formatScore(development?.score ?? null)}.`;
}

function formatScore(score: number | null) {
  return score === null ? "-" : score.toFixed(1);
}

function formatDate(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
}

function radarPoints(values: number[], radius: number, center: number) {
  return values.map((value, index) => {
    const point = pointAt(index, values.length, radius * value / 5, center);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function pointAt(index: number, total: number, radius: number, center: number) {
  const angle = -Math.PI / 2 + index * Math.PI * 2 / total;
  return { x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
}

function heatmapTone(score: number | null) {
  if (score === null) return { background: "#EEF2F7", text: "#94A3B8" };
  if (score >= 4) return { background: "#D1FAE5", text: "#065F46" };
  if (score >= 3) return { background: "#FEF3C7", text: "#92400E" };
  if (score >= 2) return { background: "#FFEDD5", text: "#9A3412" };
  return { background: "#FEE2E2", text: "#991B1B" };
}

function shortDimensionName(code: string) {
  const names: Record<string, string> = {
    goal_alignment: "Goal Align.",
    communication: "Communication",
    data_based_decision: "Data Decision",
    execution_discipline: "Execution",
    accountability: "Accountability",
    adaptability: "Adaptability",
    collaboration: "Collaboration",
    org_ownership: "Org. Ownership",
  };
  return names[code] || code;
}
