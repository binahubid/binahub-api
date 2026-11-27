import React from "react";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  Defs, Document, Font, Image as PDFImage, LinearGradient, Link, Page, Path, Rect, Stop, StyleSheet, Svg,
  Text, View, renderToBuffer,
} from "@react-pdf/renderer";
import { PDFBrand, PDFFooter, pdfStyles as base } from "@/lib/pdf-brand";
import { spinSummaryPoints } from "@/lib/spin/summary-points";
import type { ProposalSnapshot } from "./proposal";

const midnight = "#071a33";
const navy = "#0b2c6b";
const blue = "#164d9c";
const gold = "#d9a441";
const lightGold = "#ffd98b";
const muted = "#375578";
const sky = "#e8f3ff";
const proposalFont = "Plus Jakarta Sans";
const fontDirectory = path.join(process.cwd(), "public/fonts");

// Static weights from the same release used by the public website.
Font.register({
  family: proposalFont,
  fonts: [
    { src: path.join(fontDirectory, "PlusJakartaSans-Regular.ttf"), fontWeight: 400 },
    { src: path.join(fontDirectory, "PlusJakartaSans-SemiBold.ttf"), fontWeight: 600 },
    { src: path.join(fontDirectory, "PlusJakartaSans-Bold.ttf"), fontWeight: 700 },
  ],
});
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
  page: { ...base.page, fontFamily: proposalFont, color: "#18304f" },
  cover: { position: "relative", height: 841.89, paddingTop: 38 },
  coverPhoto: { position: "absolute", left: 0, top: 83, width: 595.28, height: 372.6, objectFit: "contain" },
  coverArt: { position: "absolute", left: 0, right: 0, top: 373, bottom: 0 },
  coverTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  coverDate: { alignItems: "flex-end", paddingTop: 4 },
  coverTitleBlock: { position: "absolute", left: 42, right: 42, top: 465 },
  coverTitle: { fontSize: 53, fontWeight: 700, color: "#fff", letterSpacing: -2.1 },
  coverSubtitle: { fontSize: 33, fontWeight: 600, color: "#d9ecff", letterSpacing: -1.05, marginTop: -3 },
  coverClientPanel: {
    position: "absolute", left: 42, right: 42, top: 620, paddingVertical: 13, paddingHorizontal: 17,
    borderLeftWidth: 2, borderLeftColor: gold, backgroundColor: "#fff", borderTopRightRadius: 15,
  },
  coverClient: { fontSize: 19, fontWeight: 700, color: navy, marginTop: 4, marginBottom: 5 },
  coverClientLong: { fontSize: 13.5 },
  coverDetail: { fontSize: 9.5, color: muted, marginTop: 2 },
  coverBottom: { position: "absolute", bottom: 31, left: 42, right: 42, flexDirection: "row", justifyContent: "space-between" },
  coverTagline: { fontSize: 8.5, color: "#d9ecff", letterSpacing: .25 },
  coverWeb: { fontSize: 9, color: "#fff", textDecoration: "none", fontWeight: 700 },
  subhead: { marginTop: 14, marginBottom: 7, fontSize: 12, fontWeight: 700, color: navy },
  sectionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  headRef: { fontSize: 8, color: muted, marginTop: 7, fontWeight: 700 },
  banner: {
    position: "relative", overflow: "hidden", paddingVertical: 15, paddingHorizontal: 18,
    marginBottom: 13, backgroundColor: navy, borderRadius: 13,
  },
  panelArt: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 },
  cornerArt: { position: "absolute", right: 0, top: 0 },
  bannerLabel: { color: lightGold, fontSize: 8.5, fontWeight: 700, letterSpacing: 1.1, marginBottom: 6 },
  bannerTitle: { color: "#fff", fontSize: 23, fontWeight: 700, maxWidth: 447, letterSpacing: -.66 },
  bannerMeta: { color: "#d9ecff", fontSize: 9, marginTop: 5 },
  metrics: { flexDirection: "row", gap: 8, marginBottom: 12 },
  metric: { flex: 1, minHeight: 51, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9, overflow: "hidden" },
  metricLabel: { fontSize: 8.5, color: muted, marginBottom: 5 },
  metricValue: { fontSize: 14, fontWeight: 700, color: navy },
  deliveryDetails: { marginBottom: 10 },
  schedule: { marginTop: 4 },
  flowSection: { flexDirection: "row", marginBottom: 7 },
  flowRail: { width: 20, flexShrink: 0, alignItems: "center", position: "relative" },
  flowDot: { width: 10, height: 10, borderRadius: 5, marginTop: 12 },
  flowLine: { position: "absolute", width: 1, top: 21, bottom: -20, backgroundColor: "#8eb3de" },
  flowPanel: { flex: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, borderRadius: 9 },
  flowTitle: { fontSize: 11, fontWeight: 700, marginBottom: 5, color: navy },
  bullet: { flexDirection: "row", marginBottom: 4 },
  scopePanel: { marginTop: 4, paddingVertical: 8, paddingHorizontal: 13, borderLeftWidth: 2, borderLeftColor: gold, backgroundColor: "#fff6e3" },
  dot: { width: 12, flexShrink: 0, fontWeight: 700 },
  bulletText: { flex: 1 },
  priceBox: { position: "relative", overflow: "hidden", backgroundColor: sky, borderRadius: 10, padding: 13, marginBottom: 13 },
  priceTitle: { marginBottom: 5, fontSize: 20, fontWeight: 700, color: navy },
  tableHead: { paddingVertical: 8, paddingHorizontal: 11, flexDirection: "row", backgroundColor: "#dcecff", borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  tableRow: { paddingVertical: 8, paddingHorizontal: 11, flexDirection: "row", borderBottomWidth: .65, borderBottomColor: "#d8e7fa" },
  tableEven: { backgroundColor: "#f4f8ff" },
  tableText: { width: "68%", paddingRight: 12 },
  tableAmount: { width: "32%", textAlign: "right", color: navy, fontWeight: 700, fontSize: 10 },
  tableLabel: { color: navy, fontSize: 9, fontWeight: 700 },
  total: { padding: 13, marginTop: 13, marginBottom: 8, backgroundColor: navy, borderRadius: 12, overflow: "hidden" },
  totalLabel: { fontSize: 9.5, fontWeight: 700, color: lightGold, marginBottom: 4 },
  totalValue: { fontSize: 22, fontWeight: 700, color: "#fff" },
  totalHint: { fontSize: 9, color: "#d9ecff", marginTop: 5 },
  mix: { marginTop: 10, padding: 9, backgroundColor: sky, borderRadius: 9, overflow: "hidden" },
  mixTitle: { fontSize: 10, fontWeight: 700, color: navy, marginBottom: 6 },
  mixBar: { height: 8, flexDirection: "row", borderRadius: 4, overflow: "hidden", marginBottom: 7 },
  mixLegend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 4 },
  mixKey: { flexDirection: "row", alignItems: "center", gap: 5 },
  mixSwatch: { width: 7, height: 7, borderRadius: 2 },
  nextSteps: { flexDirection: "row", alignItems: "stretch", marginBottom: 10 },
  nextStep: { flex: 1, padding: 10, borderRadius: 9 },
  nextStepArrow: { width: 26, color: blue, textAlign: "center", alignSelf: "center", fontSize: 15 },
});

const diagramTones = {
  first: { fill: "#e5f0ff", marker: blue },
  middle: { fill: "#e5f6fc", marker: "#157494" },
  last: { fill: "#fff2d6", marker: "#976016" },
};
type DiagramStage = { label: string; items: string[]; tone: keyof typeof diagramTones };

function CoverBackdrop() {
  return (
    <Svg fixed width={595.28} height={468.89} viewBox="0 0 595.28 469" style={s.coverArt}>
      <Defs>
        <LinearGradient id="cover-blue" x1="0%" y1="32%" x2="100%" y2="72%">
          <Stop offset="0%" stopColor={midnight} />
          <Stop offset="58%" stopColor={navy} />
          <Stop offset="100%" stopColor="#1b5eac" />
        </LinearGradient>
      </Defs>
      <Path d="M0 68C165 29 224 84 357 60C460 41 502 17 595.28 8V469H0Z" fill="#dcecff" />
      <Path d="M0 78C159 40 228 97 371 65C466 44 522 20 595.28 18V469H0Z" fill="url(#cover-blue)" />
      <Path d="M0 78C159 40 228 97 371 65C466 44 522 20 595.28 18" fill="none" stroke={gold} strokeWidth={1.3} />
      <Path d="M341 470C425 364 494 313 595.28 296M379 470C449 388 522 349 595.28 334M425 470C484 411 536 386 595.28 373"
        fill="none" stroke="#a3d1ff" strokeWidth={.9} strokeOpacity={.29} />
    </Svg>
  );
}

function BluePanelBackdrop() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 512 104" preserveAspectRatio="none" style={s.panelArt}>
      <Defs>
        <LinearGradient id="panel-blue" x1="0%" y1="38%" x2="100%" y2="68%">
          <Stop offset="0%" stopColor={midnight} />
          <Stop offset="55%" stopColor={navy} />
          <Stop offset="100%" stopColor="#1a5cac" />
        </LinearGradient>
      </Defs>
      <Rect width={512} height={104} fill="url(#panel-blue)" />
      <Path d="M371 104C409 46 467 15 512 8V104Z" fill="#6eb1f5" fillOpacity={.13} />
      <Path d="M378 104C410 52 463 22 512 12M411 104C439 62 478 43 512 39M442 104C461 78 485 65 512 62"
        fill="none" stroke="#b6dbff" strokeWidth={.9} strokeOpacity={.29} />
    </Svg>
  );
}

function CornerBackdrop({ color }: { color: string }) {
  return (
    <Svg width={89} height={39} viewBox="0 0 89 39" style={s.cornerArt}>
      <Path d="M0 0H78Q89 0 89 11V37C60 13 36 6 0 0Z" fill={color} fillOpacity={.095} />
      <Path d="M23 0C54 8 71 20 89 36M45 0C62 6 75 16 89 27"
        fill="none" stroke={color} strokeWidth={.85} strokeOpacity={.17} />
    </Svg>
  );
}

function SectionHeader({ code, label, title, meta }: { code: string; label: string; title: string; meta?: string }) {
  return (
    <View fixed>
      <View style={s.sectionTop}><PDFBrand /><Text style={s.headRef}>{code}</Text></View>
      <View style={s.banner}>
        <BluePanelBackdrop />
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
          <CornerBackdrop color={palette.marker} />
          <Text style={s.flowTitle} minPresenceAhead={24}>{label}</Text>
          {items.map((item, itemIndex) => (
            <View key={itemIndex} style={s.bullet} wrap={false}>
              <Text style={[s.dot, { color: palette.marker }]}>•</Text><Text style={s.bulletText}>{item}</Text>
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
      <CornerBackdrop color={blue} />
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
    { label: "Durasi per program", value: `${p.days.toLocaleString("id-ID")} hari`, tone: "first" },
    { label: "Jumlah peserta", value: p.participants.toLocaleString("id-ID"), tone: "middle" },
    { label: "Format", value: venueLabels[p.venue] || p.venue, tone: "last" },
  ] as const;
  const summary: DiagramStage[] = [
    { label: "Konteks konsultasi", tone: "first", items: spinSummaryPoints(p.summary.situation) },
    { label: "Tantangan dan dampak", tone: "middle", items: [...spinSummaryPoints(p.summary.problem), ...spinSummaryPoints(p.summary.impact)] },
    { label: "Hasil yang diharapkan", tone: "last", items: spinSummaryPoints(p.summary.outcome) },
  ];

  return renderToBuffer(
    <Document title={`Proposal Program Pengembangan | ${p.company}`}
      author={`${p.consultant} | BinaHub`} subject={code}
      creationDate={new Date(p.issuedAt)} modificationDate={new Date(p.issuedAt)}>
      <Page size="A4" style={[s.page, s.cover]}>
        <PDFImage src={coverImage} style={s.coverPhoto} />
        <CoverBackdrop />
        <View style={s.coverTop}>
          <PDFBrand />
          <View style={s.coverDate}>
            <Text style={s.headRef}>{code}</Text>
            <Text style={[base.note, { marginTop: 5 }]}>{date}</Text>
          </View>
        </View>
        <View style={s.coverTitleBlock}>
          <Text style={s.coverTitle}>Proposal</Text>
          <Text style={s.coverSubtitle}>Program Pengembangan</Text>
        </View>
        <View style={s.coverClientPanel}>
          <CornerBackdrop color={blue} />
          <Text style={base.note}>Disiapkan untuk</Text>
          <Text style={client.length > 56 ? [s.coverClient, s.coverClientLong] : s.coverClient}>{client}</Text>
          {p.company && p.name && <Text style={s.coverDetail}>{p.name}</Text>}
          <Text style={s.coverDetail}>{p.consultant} · Konsultan BinaHub</Text>
        </View>
        <View style={s.coverBottom} fixed>
          <Text style={s.coverTagline}>People. Learning. Elevated.</Text>
          <Link style={s.coverWeb} src="https://binahub.id">binahub.id</Link>
        </View>
      </Page>
      <Page size="A4" style={s.page}>
        <SectionHeader code={code} label="RINGKASAN USULAN" title="Kebutuhan dan rencana pelaksanaan" />
        <View style={s.metrics} wrap={false}>
          {facts.map(({ label, value, tone }) => {
            const palette = diagramTones[tone];
            return (
              <View key={label} style={[s.metric, { backgroundColor: palette.fill }]}>
                <CornerBackdrop color={palette.marker} />
                <Text style={s.metricLabel}>{label}</Text>
                <Text style={s.metricValue}>{value}</Text>
              </View>
            );
          })}
        </View>
        <View style={s.deliveryDetails} wrap={false}>
          <Text>Lokasi: {p.location || "Dikonfirmasi bersama"}</Text>
          {p.intendedSchedule && <Text style={s.schedule}>Preferensi jadwal: {p.intendedSchedule}</Text>}
        </View>
        <FlowDiagram stages={summary} />
        {!!p.scopeNote && (
          <View style={s.scopePanel}>
            <Text orphans={2} widows={2}><Text style={s.flowTitle}>Ruang lingkup yang diusulkan</Text>{"\n"}{p.scopeNote}</Text>
          </View>
        )}
        <PDFFooter label="BinaHub | Proposal program pengembangan" />
      </Page>
      {p.programs.map(program => (
        <Page key={program.code} size="A4" style={s.page}>
          <SectionHeader code={code} label="RANCANGAN PROGRAM" title={program.name} meta={program.code} />
          <View style={s.priceBox} wrap={false}>
            <CornerBackdrop color={blue} />
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
      <Page size="A4" style={s.page}>
        <SectionHeader code={code} label="INVESTASI" title="Estimasi dan langkah berikutnya" />
        <View style={s.tableHead} minPresenceAhead={44}>
          <Text style={[s.tableLabel, s.tableText]}>Program dan komponen tambahan</Text>
          <Text style={s.tableAmount}>Estimasi (IDR)</Text>
        </View>
        {chargeRows.map(({ name, amount, note }, index) => (
          <View key={index} style={index % 2 === 0 ? [s.tableRow, s.tableEven] : s.tableRow} wrap={false}>
            <View style={s.tableText}><Text>{name}</Text>{note && <Text style={[base.note, { marginTop: 4 }]}>{note}</Text>}</View>
            <Text style={s.tableAmount}>{amount === null ? "Perlu konfirmasi" : rupiah(amount)}</Text>
          </View>
        ))}
        <View style={s.total} wrap={false}>
          <BluePanelBackdrop />
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
