import React from "react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Document, Image as PDFImage, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDFBrand, PDFFooter, pdfStyles as base, pdfColors as c } from "@/lib/pdf-brand";
import { spinSummaryPoints } from "@/lib/spin/summary-points";
import type { ProposalSnapshot } from "./proposal";

const midnight = "#091d40";
const blue = "#194383";
const gold = "#d2a14d";
const coverImage = { data: readFileSync(path.join(process.cwd(), "public/brand/consultant-proposal-cover.jpg")), format: "jpg" as const };
const month = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Jakarta" });
const issuedDate = new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" });

export const rupiah = (v: number | null) => v === null ? "—" : "Rp" + v.toLocaleString("id-ID");

export function consultantProposalCode(issuedAt: string, proposalId: string) {
  const parts = month.formatToParts(new Date(issuedAt));
  const date = ["year", "month"].map(part => parts.find(entry => entry.type === part)?.value).join("");
  const serial = createHash("sha256").update(proposalId).digest("hex").slice(0, 10).toUpperCase();
  return `BH/${date}/${serial}`;
}

export const consultantProposalFilename = (issuedAt: string, proposalId: string) =>
  "Proposal-BinaHub-" + consultantProposalCode(issuedAt, proposalId).replaceAll("/", "-") + ".pdf";

const venueLabels: Record<string, string> = { indoor: "Indoor", outdoor: "Outdoor", hybrid: "Kombinasi", online: "Online" };

const s = StyleSheet.create({
  cover: { position: "relative", height: 841.89, paddingTop: 42, paddingBottom: 40 },
  coverBackground: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "#f6f9fd" },
  coverBlue: { position: "absolute", width: 170, height: 381, top: 391, right: 0, backgroundColor: midnight, borderTopLeftRadius: 90 },
  coverPhoto: { position: "absolute", left: 0, top: 391, width: 564, height: 353, objectFit: "contain" },
  coverEdge: { position: "absolute", left: 42, top: 378, width: 42, height: 3, backgroundColor: gold },
  coverTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  coverDate: { alignItems: "flex-end", paddingTop: 4 },
  coverTitle: { fontSize: 49, fontWeight: 700, color: midnight, letterSpacing: -1.65, marginTop: 43 },
  coverSubtitle: { fontSize: 25, color: blue, letterSpacing: -.7, marginTop: 1 },
  coverRule: { width: 44, height: 2, backgroundColor: gold, marginTop: 21, marginBottom: 18 },
  coverClient: { fontSize: 22, fontWeight: 600, color: c.navy, maxWidth: 433, marginTop: 4, marginBottom: 8 },
  coverClientLong: { fontSize: 16 },
  coverDetail: { fontSize: 10, color: c.muted, marginBottom: 4 },
  coverBottom: { position: "absolute", bottom: 36, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between" },
  coverWeb: { fontSize: 9, color: c.navy, textDecoration: "none", fontWeight: 600 },
  subhead: { marginTop: 16, marginBottom: 8, fontSize: 12, fontWeight: 600, color: c.navy },
  sectionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headRef: { fontSize: 8, color: c.muted, marginTop: 7, fontWeight: 600 },
  banner: { position: "relative", paddingVertical: 17, paddingHorizontal: 18, marginBottom: 15, backgroundColor: midnight, borderTopRightRadius: 24 },
  bannerLabel: { color: "#f5cb83", fontSize: 8.5, fontWeight: 600, letterSpacing: 1, marginBottom: 7 },
  bannerTitle: { color: "#fff", fontSize: 23, fontWeight: 600, maxWidth: 452, letterSpacing: -.6 },
  bannerMeta: { color: "#d8e6fa", fontSize: 9, marginTop: 7 },
  metrics: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metric: { flex: 1, minHeight: 54, backgroundColor: c.ice, padding: 10 },
  metricLabel: { fontSize: 9, color: c.muted, marginBottom: 6 },
  metricValue: { fontSize: 14, fontWeight: 700, color: c.navy },
  scopePlace: { marginBottom: 10 },
  line: { marginBottom: 7 },
  flowSection: { flexDirection: "row", marginBottom: 7 },
  flowRail: { width: 20, flexShrink: 0, alignItems: "center", position: "relative" },
  flowDot: { width: 10, height: 10, borderRadius: 5, marginTop: 12 },
  flowLine: { position: "absolute", width: 1, top: 21, bottom: -21, backgroundColor: "#b8c9e1" },
  flowPanel: { flex: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, borderTopRightRadius: 14 },
  flowTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6, color: midnight },
  bullet: { flexDirection: "row", marginBottom: 4 },
  scopePanel: { marginTop: 3, paddingVertical: 8, paddingHorizontal: 13, borderLeftWidth: 2, borderLeftColor: gold, backgroundColor: "#fbf8f0" },
  dot: { color: blue, width: 13, flexShrink: 0, fontWeight: 600 },
  bulletText: { flex: 1 },
  priceBox: { borderLeftWidth: 2, borderLeftColor: gold, backgroundColor: c.ice, padding: 14, marginBottom: 18 },
  priceTitle: { marginBottom: 7, fontSize: 19, fontWeight: 700, color: midnight },
  tableHead: { paddingVertical: 9, paddingHorizontal: 11, flexDirection: "row", backgroundColor: c.ice },
  tableRow: { paddingVertical: 9, paddingHorizontal: 11, flexDirection: "row", borderBottomWidth: .6, borderBottomColor: c.rule },
  tableText: { width: "68%", paddingRight: 12 },
  tableAmount: { width: "32%", textAlign: "right", color: c.navy, fontWeight: 600, fontSize: 10 },
  total: { padding: 14, marginTop: 15, marginBottom: 8, backgroundColor: midnight, borderTopRightRadius: 19 },
  totalLabel: { fontSize: 9.5, fontWeight: 600, color: "#f5cb83", marginBottom: 5 },
  totalValue: { fontSize: 21, fontWeight: 700, color: "#fff" },
  totalHint: { fontSize: 9, color: "#d8e6fa", marginTop: 6 },
  mix: { marginTop: 11, padding: 10, backgroundColor: c.ice, borderTopRightRadius: 13 },
  mixTitle: { fontSize: 10, fontWeight: 700, color: c.navy, marginBottom: 7 },
  mixBar: { height: 8, flexDirection: "row", borderRadius: 4, overflow: "hidden", marginBottom: 7 },
  mixLegend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  mixKey: { flexDirection: "row", alignItems: "center", gap: 5 },
  mixSwatch: { width: 7, height: 7, borderRadius: 2 },
  nextSteps: { flexDirection: "row", alignItems: "stretch", marginBottom: 10 },
  nextStep: { flex: 1, padding: 11, borderTopRightRadius: 12 },
  nextStepArrow: { width: 26, color: blue, textAlign: "center", alignSelf: "center", fontSize: 15 },
});

const diagramTones = {
  first: { fill: "#edf3fb", marker: blue },
  middle: { fill: "#f2f6fb", marker: "#667fa4" },
  last: { fill: "#fbf5e7", marker: "#a47326" },
};
type DiagramStage = { label: string; items: string[]; tone: keyof typeof diagramTones };

function SectionHeader({ code, label, title, meta }: { code: string; label: string; title: string; meta?: string }) {
  return (
    <View fixed>
      <View style={s.sectionTop}><PDFBrand /><Text style={s.headRef}>{code}</Text></View>
      <View style={s.banner}>
        <Text style={s.bannerLabel}>{label}</Text>
        <Text style={s.bannerTitle}>{title}</Text>
        {meta && <Text style={s.bannerMeta}>{meta}</Text>}
      </View>
    </View>
  );
}

function FlowDiagram({ stages }: { stages: DiagramStage[] }) {
  const content = stages.filter(stage => stage.items.length);
  return content.map(({ label, items, tone }, index) => {
    const palette = diagramTones[tone];
    return (
      <View key={label} style={s.flowSection}>
        <View style={s.flowRail}>
          {index < content.length - 1 && <View style={s.flowLine} />}
          <View style={[s.flowDot, { backgroundColor: palette.marker }]} />
        </View>
        <View style={[s.flowPanel, { backgroundColor: palette.fill }]}>
          <Text style={s.flowTitle} minPresenceAhead={24}>{label}</Text>
          {items.map((item, itemIndex) => (
            <View key={itemIndex} style={s.bullet} wrap={false}>
              <Text style={s.dot}>•</Text><Text style={s.bulletText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  });
}

function InvestmentBreakdown({ program, additional, isEstimate }: { program: number; additional: number; isEstimate: boolean }) {
  const series = [
    { label: "Program", value: program, color: blue },
    { label: "Komponen tambahan", value: additional, color: gold },
  ];
  const total = program + additional;
  return (
    <View style={s.mix} wrap={false}>
      <Text style={s.mixTitle}>{isEstimate ? "Komposisi estimasi investasi" : "Komposisi subtotal yang sudah terhitung"}</Text>
      <View style={s.mixBar}>
        {series.map(item => <View key={item.label} style={{ width: `${item.value / total * 100}%`, backgroundColor: item.color }} />)}
      </View>
      <View style={s.mixLegend}>
        {series.map(item => <View key={item.label} style={s.mixKey}>
          <View style={[s.mixSwatch, { backgroundColor: item.color }]} />
          <Text style={base.note}>{item.label} · {rupiah(item.value)}</Text>
        </View>)}
      </View>
    </View>
  );
}

export async function consultantProposalPDF(p: ProposalSnapshot, proposalId: string) {
  const code = consultantProposalCode(p.issuedAt, proposalId);
  const date = issuedDate.format(new Date(p.issuedAt));
  const client = p.company || p.name;
  const components = p.additionalComponents ?? [];
  const programTotal = p.programs.reduce((value, program) => value + (program.total ?? 0), 0);
  const additionalTotal = components.reduce((value, item) => value + (item.amountIdr ?? 0), 0);
  const chargeRows = [
    ...p.programs.map(program => ({ name: program.name, amount: program.total, note: program.priceBasis })),
    ...components.map(item => ({ name: item.name, amount: item.amountIdr, note: undefined })),
  ];
  const facts = [
    { label: "Durasi per program", value: `${p.days.toLocaleString("id-ID")} hari` },
    { label: "Jumlah peserta", value: p.participants.toLocaleString("id-ID") },
    { label: "Format", value: venueLabels[p.venue] || p.venue },
  ];
  const summary: DiagramStage[] = [
    { label: "Konteks konsultasi", tone: "first", items: spinSummaryPoints(p.summary.situation) },
    { label: "Tantangan dan dampak", tone: "middle", items: [...spinSummaryPoints(p.summary.problem), ...spinSummaryPoints(p.summary.impact)] },
    { label: "Hasil yang diharapkan", tone: "last", items: spinSummaryPoints(p.summary.outcome) },
  ];

  return renderToBuffer(
    <Document title={`Proposal Program Pengembangan | ${p.company}`}
      author={`${p.consultant} | BinaHub`} subject={code}
      creationDate={new Date(p.issuedAt)} modificationDate={new Date(p.issuedAt)}>
      <Page size="A4" style={[base.page, s.cover]}>
        <View style={s.coverBackground} />
        <View style={s.coverBlue} />
        <PDFImage src={coverImage} style={s.coverPhoto} />
        <View style={s.coverEdge} />
        <View style={s.coverTop}>
          <PDFBrand />
          <View style={s.coverDate}>
            <Text style={s.headRef}>{code}</Text>
            <Text style={[base.note, { marginTop: 5 }]}>{date}</Text>
          </View>
        </View>
        <Text style={s.coverTitle}>Proposal</Text>
        <Text style={s.coverSubtitle}>Program Pengembangan</Text>
        <View style={s.coverRule} />
        <Text style={base.note}>Disiapkan untuk</Text>
        <Text style={client.length > 56 ? [s.coverClient, s.coverClientLong] : s.coverClient}>{client}</Text>
        {p.company && p.name && <Text style={s.coverDetail}>{p.name}</Text>}
        <Text style={s.coverDetail}>{p.consultant} · Konsultan BinaHub</Text>
        <View style={s.coverBottom}>
          <Text style={base.note}>People. Learning. Elevated.</Text>
          <Link style={s.coverWeb} src="https://binahub.id">binahub.id</Link>
        </View>
      </Page>
      <Page size="A4" style={base.page}>
        <SectionHeader code={code} label="RINGKASAN USULAN" title="Kebutuhan dan rencana pelaksanaan" />
        <View style={s.metrics} wrap={false}>
          {facts.map(({ label, value }) => (
            <View key={label} style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{value}</Text></View>
          ))}
        </View>
        <Text style={s.scopePlace}>Lokasi: {p.location || "Dikonfirmasi bersama"}</Text>
        {p.intendedSchedule && <Text style={s.line}>Preferensi jadwal: {p.intendedSchedule}</Text>}
        <FlowDiagram stages={summary} />
        {!!p.scopeNote && (
          <View style={s.scopePanel}>
            <Text orphans={2} widows={2}><Text style={s.flowTitle}>Ruang lingkup yang diusulkan</Text>{"\n"}{p.scopeNote}</Text>
          </View>
        )}
        <PDFFooter label="BinaHub | Proposal program pengembangan" />
      </Page>
      {p.programs.map(program => (
        <Page key={program.code} size="A4" style={base.page}>
          <SectionHeader code={code} label="RANCANGAN PROGRAM" title={program.name} meta={program.code} />
          <View style={s.priceBox} wrap={false}>
            <Text style={s.metricLabel}>Estimasi investasi program</Text>
            <Text style={s.priceTitle}>{program.total === null ? "Perlu konfirmasi" : rupiah(program.total)}</Text>
            <Text style={base.note}>{program.priceBasis || program.capacity}</Text>
          </View>
          <FlowDiagram stages={[
            { label: "Sasaran pembelajaran", items: program.objectives, tone: "first" },
            { label: "Komponen pelaksanaan", items: program.components ?? [], tone: "middle" },
            { label: "Hasil yang dibawa peserta", items: program.outputs ?? [], tone: "last" },
          ]} />
          <PDFFooter label="BinaHub | Proposal program pengembangan" />
        </Page>
      ))}
      <Page size="A4" style={base.page}>
        <SectionHeader code={code} label="INVESTASI" title="Estimasi dan langkah berikutnya" />
        <View style={s.tableHead} minPresenceAhead={48}>
          <Text style={[base.note, s.tableText]}>Program dan komponen tambahan</Text>
          <Text style={s.tableAmount}>Estimasi (IDR)</Text>
        </View>
        {chargeRows.map(({ name, amount, note }, index) => (
          <View key={index} style={s.tableRow} wrap={false}>
            <View style={s.tableText}><Text>{name}</Text>{note && <Text style={[base.note, { marginTop: 4 }]}>{note}</Text>}</View>
            <Text style={s.tableAmount}>{amount === null ? "Perlu konfirmasi" : rupiah(amount)}</Text>
          </View>
        ))}
        <View style={s.total} wrap={false}>
          <Text style={s.totalLabel}>Total estimasi investasi</Text>
          <Text style={s.totalValue}>{p.total === null ? "Perlu konfirmasi" : rupiah(p.total)}</Text>
          {p.total === null && p.pricedSubtotal != null && p.pricedSubtotal > 0 &&
            <Text style={s.totalHint}>Subtotal yang sudah terhitung: {rupiah(p.pricedSubtotal)}</Text>}
        </View>
        <Text style={base.note}>{p.priceNote}</Text>
        {programTotal > 0 && additionalTotal > 0 && (
          <InvestmentBreakdown program={programTotal} additional={additionalTotal} isEstimate={p.total !== null} />
        )}
        <View wrap={false}>
          <Text style={s.subhead}>Langkah berikutnya</Text>
          <View style={s.nextSteps}>
            <View style={[s.nextStep, { backgroundColor: diagramTones.first.fill }]}>
              <Text style={s.flowTitle}>Konfirmasi usulan</Text>
              <Text>{p.nextStep || "Konfirmasi ruang lingkup dan pilihan jadwal bersama konsultan BinaHub."}</Text>
            </View>
            <Text style={s.nextStepArrow}>→</Text>
            <View style={[s.nextStep, { backgroundColor: diagramTones.last.fill }]}>
              <Text style={s.flowTitle}>Rincian pelaksanaan</Text>
              <Text>BinaHub menyiapkan rincian jadwal, pembagian peserta, dan ketentuan investasi untuk disepakati.</Text>
            </View>
          </View>
          <Text style={base.note}>Penanggung jawab konsultasi: {p.consultant}</Text>
        </View>
        <PDFFooter label="BinaHub | Proposal program pengembangan" />
      </Page>
    </Document>,
  );
}
