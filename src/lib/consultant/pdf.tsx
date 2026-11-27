import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import {
  PDFHeader,
  PDFFooter,
  pdfStyles as s,
  pdfColors as c,
  pdfOverviewStyles as grid,
} from "@/lib/pdf-brand";
import type { ProposalSnapshot } from "./proposal";
import { spinSummaryPoints } from "@/lib/spin/summary-points";
export const rupiah = (v: number | null) =>
  v === null ? "—" : "Rp" + v.toLocaleString("id-ID");
export async function consultantProposalPDF(
  p: ProposalSnapshot,
  revision: number,
) {
  if (p.documentKind === "formal") return renderToBuffer(<FormalProposal p={p} revision={revision} />);
  return renderToBuffer(
    <Document title={"Proposal Program · " + p.company} author="BinaHub">
      <Page size="A4" style={s.page}>
        <PDFHeader
          title="Proposal program pengembangan"
          meta={`${p.company} · Revisi ${revision} · ${new Date(p.issuedAt).toLocaleDateString("id-ID")}`}
        />
        <Text style={{ ...s.meta, marginBottom: 18 }}>
          Disiapkan untuk {p.name} oleh {p.consultant} · Konsultan BinaHub
        </Text>
        <Text style={s.h}>Kebutuhan dan hasil yang dituju</Text>
        {(
          [
            ["Konteks", p.summary.situation],
            ["Tantangan", p.summary.problem],
            ["Dampak", p.summary.impact],
            ["Hasil yang diharapkan", p.summary.outcome],
          ] as const
        ).map(([title, value]) => (
          <View key={title} style={{ marginBottom: 12 }} wrap={false}>
            <Text style={s.sub}>{title}</Text>
            <Text>{value || "Dibahas saat konsultasi."}</Text>
          </View>
        ))}
        <Text style={{ ...s.h, marginTop: 14 }}>Rancangan pelaksanaan</Text>
        <View
          style={{ backgroundColor: c.ice, padding: 14, marginBottom: 14 }}
          wrap={false}
        >
          <Text>
            {p.days} hari · {p.participants} peserta · {p.venue}
          </Text>
          <Text style={{ marginTop: 8 }}>
            Lokasi: {p.location || "Dikonfirmasi bersama"}
          </Text>
        </View>
        {p.programs.map((program) => (
          <View
            key={program.code}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 0.7,
              borderBottomColor: c.rule,
            }}
          >
            <View minPresenceAhead={75} wrap={false}>
              <Text style={s.h}>{program.name}</Text>
              <Text style={s.note}>
                {program.code} · {program.capacity}
              </Text>
            </View>
            {program.objectives.map((objective, i) => (
              <Text key={i} style={{ marginTop: 8 }}>
                • {objective}
              </Text>
            ))}
            <Text style={{ marginTop: 12, fontWeight: 600 }}>
              {program.dailyRate === null
                ? "Tarif program: — (perlu dikonfirmasi)"
                : `${rupiah(program.dailyRate)} / hari × ${p.days} hari = ${rupiah(program.total)}`}
            </Text>
          </View>
        ))}
        {p.scopeNote && (
          <View style={{ marginTop: 18 }}>
            <Text style={s.h}>Ruang lingkup yang disepakati</Text>
            <Text>{p.scopeNote}</Text>
          </View>
        )}
        <View
          style={{ marginTop: 20, padding: 16, backgroundColor: c.ice }}
          wrap={false}
        >
          <Text style={s.h}>Estimasi tarif program: {rupiah(p.total)}</Text>
          <Text style={{ marginBottom: 10 }}>Komponen tambahan: —</Text>
          <Text style={s.note}>{p.priceNote}</Text>
        </View>
        <PDFFooter label="BinaHub | Proposal untuk pembahasan bersama" />
      </Page>
    </Document>,
  );
}

const dateLabel = (date: string) => new Date(date).toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta" });
const daysLabel = (days: number) => `${days.toLocaleString("id-ID")} hari`;
const venueLabels: Record<string, string> = {
  indoor: "Indoor", outdoor: "Outdoor", hybrid: "Kombinasi", online: "Online",
};
const line = { marginBottom: 7 };
const section = { marginTop: 18 };

function FormalProposal({ p, revision }: { p: ProposalSnapshot; revision: number }) {
  const footer = <PDFFooter label="BinaHub | Proposal kerja sama" />;
  const investment = p.total === null ? "Perlu konfirmasi" : rupiah(p.total);
  const scope = `${daysLabel(p.days)} per program · ${p.participants} peserta · ${venueLabels[p.venue] || p.venue}`;
  const outcome = spinSummaryPoints(p.summary.outcome);
  const problems = spinSummaryPoints(p.summary.problem);
  const placed = `${p.company} | Revisi ${revision} | ${dateLabel(p.issuedAt)}`;
  return (
    <Document title={`Usulan kerja sama | ${p.company}`} author={`${p.consultant} | BinaHub`}
      creationDate={new Date(p.issuedAt)} modificationDate={new Date(p.issuedAt)}>
      <Page size="A4" style={s.page}>
        <PDFHeader title="Usulan kerja sama program pengembangan" meta={placed} />
        <Text style={{ ...s.meta, marginBottom: 16 }}>Disiapkan untuk {p.name} oleh {p.consultant} · Konsultan BinaHub</Text>
        <Text style={s.h}>Ringkasan usulan</Text>
        <View style={grid.path} wrap={false}>
          <View style={grid.cell}>
            <Text style={grid.label}>Sasaran pengembangan</Text>
            {(outcome.length ? outcome.slice(0, 2) : ["Dikonfirmasi bersama klien."]).map((item, i) =>
              <Text key={i} style={line}>{item.length > 180 ? item.slice(0, 177) + "…" : item}</Text>)}
          </View>
          <View style={grid.cell}>
            <Text style={grid.label}>Rencana pelaksanaan</Text>
            <Text style={line}>{scope}</Text>
            <Text style={s.note}>{p.location || "Lokasi dikonfirmasi bersama"}</Text>
          </View>
          <View style={[grid.cell, grid.cellAccent]}>
            <Text style={grid.label}>Estimasi investasi program</Text>
            <Text style={s.h}>{investment}</Text>
            {p.total === null && p.pricedSubtotal != null && <Text style={s.note}>
              Subtotal program yang sudah terhitung: {rupiah(p.pricedSubtotal)}
            </Text>}
          </View>
        </View>
        <Text style={s.h}>Dasar usulan</Text>
        {problems.map((item, i) => <Text key={i} style={line}>• {item}</Text>)}
        {p.scopeNote && <View style={section}>
          <Text style={s.sub} minPresenceAhead={35}>Ruang lingkup pelaksanaan</Text>
          <Text>{p.scopeNote}</Text>
        </View>}
        <View style={section}>
          <Text style={s.h} minPresenceAhead={40}>Program yang diusulkan</Text>
          {p.programs.map(program => <View key={program.code} style={line} wrap={false}>
            <Text style={s.sub}>{program.name}</Text>
            <Text style={s.note}>{program.code} · {program.total === null ? "Investasi perlu konfirmasi" : rupiah(program.total)}</Text>
          </View>)}
        </View>
        {footer}
      </Page>
      {p.programs.map(program => <Page key={program.code} size="A4" style={s.page}>
        <PDFHeader title={program.name} meta={`${program.code} | Rancangan pelaksanaan untuk ${p.company}`} />
        <View style={grid.row}>
          <View style={grid.main}>
            <Text style={s.h}>Sasaran pembelajaran</Text>
            {program.objectives.map((item, i) => <Text key={i} style={line}>• {item}</Text>)}
          </View>
          <View style={grid.aside}>
            <Text style={s.sub}>Investasi program</Text>
            <Text style={s.h}>{program.total === null ? "Perlu konfirmasi" : rupiah(program.total)}</Text>
            <Text style={line}>{program.priceBasis}</Text>
            <Text style={s.note}>{program.capacity}</Text>
          </View>
        </View>
        {!!program.components?.length && <View style={section}>
          <Text style={s.h} minPresenceAhead={35}>Komponen pelaksanaan</Text>
          {program.components.map((item, i) => <Text key={i} style={line}>• {item}</Text>)}
        </View>}
        {!!program.outputs?.length && <View style={section}>
          <Text style={s.h} minPresenceAhead={35}>Hasil yang dibawa peserta</Text>
          {program.outputs.map((item, i) => <Text key={i} style={line}>• {item}</Text>)}
        </View>}
        {footer}
      </Page>)}
      <Page size="A4" style={s.page}>
        <PDFHeader title="Investasi dan langkah berikutnya" meta={placed} />
        <Text style={s.h}>Rincian investasi</Text>
        {p.programs.map(program => <View key={program.code} wrap={false} style={{ ...line, borderBottomWidth: 0.7, borderBottomColor: c.rule, paddingBottom: 8 }}>
          <Text style={s.sub}>{program.name} · {program.total === null ? "Perlu konfirmasi" : rupiah(program.total)}</Text>
          <Text style={s.note}>{program.priceBasis}</Text>
        </View>)}
        <View style={{ ...section, padding: 12, backgroundColor: c.ice }} wrap={false}>
          <Text style={s.sub}>Estimasi investasi program · {investment}</Text>
          {p.total === null && p.pricedSubtotal != null && <Text style={line}>Subtotal yang terhitung: {rupiah(p.pricedSubtotal)}</Text>}
          <Text style={line}>Komponen tambahan: —</Text>
          <Text style={s.note}>{p.priceNote}</Text>
        </View>
        <View style={section}>
          <Text style={s.h} minPresenceAhead={70}>Persiapan kesepakatan</Text>
          <Text style={line}>1. {p.nextStep}</Text>
          <Text style={line}>2. BinaHub menyiapkan rincian jadwal, pembagian peserta, dan ketentuan investasi yang perlu disepakati.</Text>
          <Text style={line}>3. Setelah disetujui, tim BinaHub mengoordinasikan persiapan pelaksanaan.</Text>
          {p.intendedSchedule && <Text style={line}>Preferensi jadwal: {p.intendedSchedule}</Text>}
          <Text style={s.note}>Penanggung jawab konsultasi: {p.consultant}</Text>
        </View>
        {footer}
      </Page>
    </Document>
  );
}
